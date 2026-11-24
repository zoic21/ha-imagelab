"""Cover on-demand analysis, source edits and detection previews."""

import asyncio
import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request
from homeassistant.components.http import KEY_HASS, KEY_HASS_USER
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers.http import KEY_AUTHENTICATED

from custom_components.image_lab import ImageLabPreviewView, async_test_source
from custom_components.image_lab import analysis, config_flow, object_detection, output
from custom_components.image_lab.comparison_store import ComparisonStore
from custom_components.image_lab.images import ImageError, ImageFrame
from custom_components.image_lab.models import ModuleResult
from custom_components.image_lab.output import OutputCoordinator
from custom_components.image_lab.result_store import get_result_store


def loaded_entry(module: str) -> SimpleNamespace:
    return SimpleNamespace(
        entry_id="profile", domain="image_lab", state=ConfigEntryState.LOADED,
        disabled_by=None, options={},
        data={"module": module, "source_type": "camera", "entity_id": "camera.old", "image_key": "original"},
    )


def test_zone_edit_during_analysis_reuses_full_source(monkeypatch):
    async def run():
        entry = loaded_entry("palette")
        hass = SimpleNamespace(config_entries=SimpleNamespace(async_get_entry=lambda _: entry))
        original = ImageFrame(b"full image", "image/jpeg", 200, 100)
        crop = ImageFrame(b"cropped image", "image/png", 100, 100)
        region = {"x": 0.5, "y": 0, "width": 0.5, "height": 1}
        acquire = AsyncMock(return_value=original)
        monkeypatch.setattr(analysis, "async_get_frame", acquire)
        monkeypatch.setattr(analysis, "resolve_entity_id", lambda _hass, entity_id: entity_id)

        async def process(_hass, _, frame, _settings):
            assert frame is original
            if "region" not in entry.data:
                entry.data = {**entry.data, "region": region}
                return ModuleResult({"dominant_hex": "#ff0000"}), original
            return ModuleResult({"dominant_hex": "#0000ff"}), crop

        monkeypatch.setitem(analysis.MODULES, "palette", replace(analysis.MODULES["palette"], process=process))
        result = await analysis.async_analyze(hass, entry.entry_id)
        assert result.response["status"] == "ok"
        assert result.response["data"]["dominant_hex"] == "#0000ff"
        assert result.frame is crop
        acquire.assert_awaited_once()

    asyncio.run(run())


def test_camera_change_resets_region_and_requires_current_review(tmp_path, monkeypatch):
    async def run():
        entry = loaded_entry("comparison")
        store = ComparisonStore(SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath)), entry.entry_id)
        gallery = store.load()
        gallery["settings"]["region"] = {"x": 0, "y": 0, "width": 0.5, "height": 1}
        gallery["states"] = [{"id": "open", "name": "Open"}]
        gallery["references"] = [{"id": "original", "state_id": "open", "name": "Open", "source": "upload"}]
        store._save(gallery)

        async def executor(job, *args):
            return job(*args)

        hass = SimpleNamespace(
            config=store.hass.config,
            config_entries=SimpleNamespace(async_get_entry=lambda _: entry),
            async_add_executor_job=executor,
            async_create_task=lambda coro, _name: asyncio.create_task(coro),
            data={},
        )
        flow = config_flow.ImageLabConfigFlow()
        flow.hass = hass
        flow._entry = entry
        flow._settings = {"module": "comparison", "source_type": "camera", "image_key": "original"}
        monkeypatch.setattr(config_flow, "resolve_entity_id", lambda _hass, entity_id: entity_id)
        monkeypatch.setattr(config_flow.er, "async_get", lambda _hass: SimpleNamespace(async_get=lambda _: None))

        def apply_entry(current, *, data, **_kwargs):
            current.data = data

        monkeypatch.setattr(flow, "async_update_reload_and_abort", apply_entry)
        await flow.async_step_image({"entity_id": "camera.old"})
        assert store.load()["settings"]["region"] == gallery["settings"]["region"]
        await flow.async_step_image({"entity_id": "camera.new"})
        changed = store.load()
        assert changed["settings"]["region"] is None
        assert changed["references"] == gallery["references"]
        frame = ImageFrame(b"new camera frame", "image/jpeg", 1, 1)
        assert store._run(frame, changed)[0].reason == "references_need_review"

        await flow.async_step_image({"entity_id": "camera.third"})
        current = store.load()
        with pytest.raises(ImageError, match="reference_review_changed"):
            store._apply("confirm_references", {"review_id": changed["reference_review"]}, None)
        approved = store._apply("confirm_references", {"review_id": current["reference_review"]}, None)
        assert "reference_review" not in approved
        assert approved["references"] == gallery["references"]

    asyncio.run(run())


def test_detector_shares_cooldown_and_recovers(monkeypatch):
    async def run():
        detector = object_detection.ObjectDetector()
        model = Mock()
        executor = AsyncMock(return_value="detected")
        hass = SimpleNamespace(async_add_executor_job=executor)
        load = AsyncMock(side_effect=(ImageError("object_model_unavailable"), model))
        monkeypatch.setattr(detector, "_async_load", load)
        clock = Mock(return_value=100)
        monkeypatch.setattr(object_detection, "monotonic", clock)

        args = (hass, ImageFrame(b"image", "image/jpeg", 1, 1), [], 40, False)
        errors = await asyncio.gather(*(detector.async_detect(*args) for _ in range(3)), return_exceptions=True)
        assert [err.reason for err in errors] == ["object_model_unavailable"] * 3
        load.assert_awaited_once()
        executor.assert_not_called()
        clock.return_value += object_detection._LOAD_RETRY_SECONDS
        assert await detector.async_detect(*args) == "detected"
        assert await detector.async_detect(*args) == "detected"
        assert load.await_count == 2

    asyncio.run(run())


def test_test_source_publishes_the_first_capture_over_websocket(monkeypatch):
    async def run():
        entry = loaded_entry("comparison")
        entry.options = {"confirmation_seconds": 60}
        frame = ImageFrame(b"new capture", "image/jpeg", 1, 1)
        response = {"status": "ok", "data": {"state_id": "open"}}
        result = analysis.AnalysisResult(response, frame)
        analyze = AsyncMock(return_value=result)
        monkeypatch.setattr(output, "async_analyze", analyze)
        tasks = []

        def schedule(coro, _name, *, eager_start):
            tasks.append(asyncio.create_task(coro))

        hass = SimpleNamespace(
            config_entries=SimpleNamespace(async_get_entry=lambda _: entry),
            async_create_background_task=schedule,
            async_create_task=lambda coro, name: asyncio.create_task(coro, name=name),
        )
        coordinator = object.__new__(OutputCoordinator)
        coordinator.hass = hass
        coordinator.name = "Door analysis"
        coordinator.kind = "enum"
        coordinator.is_meter = False
        coordinator.config_entry = entry
        coordinator.analysis_lock = asyncio.Lock()
        coordinator._unloaded = asyncio.Event()
        coordinator._confirmed = coordinator._retained = {"status": "ok", "data": {"state_id": "closed"}}
        coordinator._save_observation = AsyncMock(return_value={
            "id": "capture", "time": "now", "manual": True, "response": response,
            "width": frame.width, "height": frame.height,
        })
        coordinator.async_set_updated_data = Mock(side_effect=lambda data: setattr(coordinator, "data", data))
        entry.runtime_data = coordinator
        connection = Mock(user=SimpleNamespace(is_admin=True))
        async_test_source(hass, connection, {"id": 1, "profile_id": entry.entry_id})
        await asyncio.wait_for(tasks[0], timeout=1)
        analyze.assert_awaited_once_with(hass, entry.entry_id, scheduled_capture=None)
        coordinator._save_observation.assert_awaited_once_with(result, True)
        coordinator.async_set_updated_data.assert_called_once_with(response)
        assert coordinator.entity_response == coordinator._confirmed == response
        connection.send_result.assert_called_once_with(1, {
            **response, "image_id": "capture", "time": "now", "manual": True,
            "width": frame.width, "height": frame.height,
        })

    asyncio.run(run())


def test_preview_post_only_updates_history_settings(tmp_path):
    async def run():
        entry = loaded_entry("palette")
        entry.runtime_data = AsyncMock()
        hass = HomeAssistant(str(tmp_path))
        hass.config_entries = SimpleNamespace(async_get_entry=lambda _: entry)

        @web.middleware
        async def admin(request, handler):
            request[KEY_AUTHENTICATED] = True
            request[KEY_HASS_USER] = SimpleNamespace(is_admin=True)
            return await handler(request)

        app = web.Application(middlewares=[admin])
        app[KEY_HASS] = hass
        ImageLabPreviewView().register(hass, app, app.router)
        async with TestClient(TestServer(app)) as client:
            path = f"/api/image_lab/preview/{entry.entry_id}"
            retired = await client.post(path)
            assert retired.status == 405
            assert retired.headers["Allow"] == "GET"
            assert (await client.get(path)).status == 204
            settings = {"mode": "all", "limit": 3}
            saved = await client.post(f"{path}/history_settings", json=settings)
            assert saved.status == 200
            assert await (await client.get(f"{path}/history_settings")).json() == settings
            entry.runtime_data.async_run_manual.assert_not_awaited()

    asyncio.run(run())


@pytest.mark.parametrize(("module", "data", "latest_data"), [
    ("object_detection", {"objects": [{
        "label": "person", "confidence": 0.9876,
        "box": {"x_min": 0.0123, "y_min": 0.2345, "x_max": 0.6789, "y_max": 0.9876},
    }] * 100, "truncated": True}, {"objects": [], "truncated": False}),
    ("palette", {"palette_rgb": [[80, 20, 10], [0, 64, 255]]}, {"palette_rgb": [[0, 0, 0]]}),
    ("meter", {"value": 0, "unit": "m³"}, {"candidate": 103, "meter_value": 0, "unit": "m³"}),
])
def test_preview_metadata_is_json_for_exact_image(tmp_path, module, data, latest_data):
    async def run():
        entry = loaded_entry(module)

        async def executor(job, *args):
            return job(*args)

        hass = SimpleNamespace(
            config=SimpleNamespace(path=tmp_path.joinpath), data={}, async_add_executor_job=executor,
            config_entries=SimpleNamespace(async_get_entry=lambda _: entry),
        )
        view = ImageLabPreviewView()
        store = get_result_store(hass, entry.entry_id)
        frame = ImageFrame(b"original image bytes", "image/jpeg", 640, 480)
        response = {"status": "ok", "module": module, "data": data}
        observation = store._record(frame, response, manual=True)
        store._set_history_settings(store.load(), {"mode": "off", "limit": 1})
        latest_response = {**response, "data": latest_data}
        if module == "meter":
            latest_response.update(status="unknown", reason="meter_too_fast")
        else:
            latest_response["confirmation"] = "disagreed"
        latest = store._record(frame, latest_response, manual=False)

        def request(suffix=""):
            req = make_mocked_request("GET", "/preview/profile" + suffix, app={KEY_HASS: hass})
            req[KEY_HASS_USER] = SimpleNamespace(is_admin=True)
            return req

        for item, image_path in ((observation, observation["id"]), (latest, None)):
            image = await view.get(request(), entry.entry_id, image_path)
            assert image.body == frame.content
            assert image.headers["ETag"] == f'"{item["id"]}"'
            assert not any(key.lower().startswith("x-image-lab-") for key in image.headers)
            metadata = await view.get(request(f"/{item['id']}?metadata=1"), entry.entry_id, item["id"])
            assert metadata.content_type == "application/json"
            assert json.loads(metadata.body) == {
                **item["response"], "image_id": item["id"], "time": item["time"],
                "manual": item["manual"], "width": frame.width, "height": frame.height,
            }
        with pytest.raises(web.HTTPNotFound):
            await view.get(request("/missing?metadata=1"), entry.entry_id, "missing")

    asyncio.run(run())


def test_scheduled_frame_is_skipped_during_another_analysis():
    async def run():
        coordinator = object.__new__(OutputCoordinator)
        coordinator.analysis_lock = asyncio.Lock()
        coordinator._unloaded = asyncio.Event()
        coordinator._observe = AsyncMock()
        frame = asyncio.create_task(asyncio.sleep(0, result=ImageFrame(b"image", "image/jpeg", 1, 1)))
        async with coordinator.analysis_lock:
            await asyncio.wait_for(coordinator.async_process_capture(frame), timeout=1)
        await frame
        coordinator._observe.assert_not_called()

    asyncio.run(run())
