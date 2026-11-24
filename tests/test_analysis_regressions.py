"""Cover on-demand analysis, source edits and detection previews."""

import asyncio
import json
import sys
from dataclasses import replace
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request
from homeassistant.components.http import KEY_HASS, KEY_HASS_USER
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.helpers.http import KEY_AUTHENTICATED
from PIL import Image, JpegImagePlugin

from custom_components.image_lab import ImageLabPreviewView, ImportedThumbnailView
from custom_components.image_lab import analysis, config_flow, object_detection, output
from custom_components.image_lab.comparison_store import ComparisonStore
from custom_components.image_lab.images import ImageError, ImageFrame, validate_image
from custom_components.image_lab.models import ModuleResult
from custom_components.image_lab.output import ConfirmingOutputCoordinator, OutputCoordinator
from custom_components.image_lab.result_store import get_result_store
from custom_components.image_lab.websocket import async_test_source


def loaded_entry(module: str) -> SimpleNamespace:
    return SimpleNamespace(
        entry_id="profile", domain="image_lab", state=ConfigEntryState.LOADED,
        disabled_by=None, options={},
        data={"module": module, "source_type": "camera", "entity_id": "camera.old", "image_key": "original"},
    )


def camera_jpeg() -> bytes:
    buffer = BytesIO()
    image = Image.new("RGB", (320, 240), "red")
    image.paste("blue", (160, 0, 320, 240))
    image.save(buffer, "JPEG")
    return buffer.getvalue()


@pytest.fixture
def camera_capture(monkeypatch):
    capture = AsyncMock()
    monkeypatch.setitem(
        sys.modules, "homeassistant.components.camera", SimpleNamespace(async_get_image=capture)
    )
    return capture


@pytest.mark.parametrize("scheduled", [False, True])
def test_zone_analysis_decodes_camera_jpeg_once(monkeypatch, camera_capture, scheduled):
    async def run():
        entry = loaded_entry("palette")
        entry.data["region"] = {"x": 0.5, "y": 0, "width": 0.5, "height": 1}
        camera_capture.return_value = SimpleNamespace(content=camera_jpeg())
        monkeypatch.setattr(analysis, "resolve_entity_id", lambda _, value: value)
        hass = SimpleNamespace(
            config_entries=SimpleNamespace(async_get_entry=lambda _: entry),
            config=SimpleNamespace(components={"camera"}), states=Mock(), data={},
            async_add_executor_job=asyncio.to_thread, async_create_task=asyncio.create_task,
        )
        decodes = []
        load = JpegImagePlugin.JpegImageFile.load

        def track_load(image):
            if image.tile:
                decodes.append(image.size)
            return load(image)

        monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "load", track_load)
        frame = output.scheduled_frame(hass, entry.data["entity_id"]) if scheduled else None
        result = await analysis.async_analyze(hass, entry.entry_id, scheduled_capture=frame)
        assert result.response["status"] == "ok"
        assert result.frame.width == 160
        assert decodes == [(320, 240)]
        camera_capture.assert_awaited_once()

    asyncio.run(run())


@pytest.mark.parametrize("module", ["palette", "object_detection", "comparison", "meter"])
def test_truncated_capture_never_produces_an_observation(tmp_path, monkeypatch, camera_capture, module):
    async def run():
        content = camera_jpeg()[:-100]
        with pytest.raises(ImageError, match="invalid_image"):
            validate_image(content)
        entry = loaded_entry(module)
        camera_capture.return_value = SimpleNamespace(content=content)
        monkeypatch.setattr(analysis, "resolve_entity_id", lambda _, value: value)
        hass = SimpleNamespace(
            config_entries=SimpleNamespace(async_get_entry=lambda _: entry),
            config=SimpleNamespace(components={"camera"}, path=tmp_path.joinpath), states=Mock(),
            async_add_executor_job=asyncio.to_thread, async_create_task=lambda coro, _: asyncio.create_task(coro),
            data={},
        )
        if module == "object_detection":
            detector = object_detection.ObjectDetector()
            detector._detector = object.__new__(object_detection._NanoDet)
            hass.data["image_lab.object_detector"] = detector
        result = await analysis.async_analyze(hass, entry.entry_id)
        assert result.response["reason"] == "invalid_image"
        assert result.frame is None

    asyncio.run(run())


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
        frame = validate_image(camera_jpeg())
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
        coordinator = object.__new__(ConfirmingOutputCoordinator)
        coordinator.hass = hass
        coordinator.name = "Door analysis"
        coordinator.kind = "enum"
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


def test_panel_websocket_registration_and_capture_subscription(tmp_path):
    from homeassistant.exceptions import Unauthorized
    from homeassistant.helpers.dispatcher import async_dispatcher_send

    from custom_components.image_lab.result_store import SIGNAL_CAPTURE_SAVED
    from custom_components.image_lab.websocket import async_register_commands

    async def run():
        hass = HomeAssistant(str(tmp_path))
        async_register_commands(hass)
        commands = hass.data["websocket_api"]
        assert set(commands) == {
            "image_lab/subscribe_profiles", "image_lab/subscribe_captures", "image_lab/test_source",
            "image_lab/module_settings", "image_lab/set_publication",
        }
        connection = Mock(subscriptions={}, user=SimpleNamespace(is_admin=False))
        for handler, _ in commands.values():
            with pytest.raises(Unauthorized):
                handler(hass, connection, {"id": 1})

        connection.user.is_admin = True
        subscribe, _ = commands["image_lab/subscribe_captures"]
        subscribe(hass, connection, {"id": 1})
        connection.send_result.assert_called_once_with(1)
        connection.send_message.assert_called_once_with({"id": 1, "type": "event", "event": None})
        async_dispatcher_send(hass, SIGNAL_CAPTURE_SAVED, "profile", "capture")
        await hass.async_block_till_done()
        connection.send_message.assert_called_with({
            "id": 1, "type": "event", "event": {"profile_id": "profile", "image_id": "capture"},
        })
        connection.subscriptions.pop(1)()
        async_dispatcher_send(hass, SIGNAL_CAPTURE_SAVED, "profile", "next")
        await hass.async_block_till_done()
        assert connection.send_message.call_count == 2

    asyncio.run(run())


def test_source_thumbnail_reads_current_upload_before_any_analysis(tmp_path):
    async def run():
        key = "1234567890abcdef1234567890abcdef"
        entry = loaded_entry("comparison")
        entry.data.update(source_type="upload", image_key=key)
        hass = SimpleNamespace(
            config=SimpleNamespace(path=tmp_path.joinpath), data={}, async_add_executor_job=asyncio.to_thread,
            config_entries=SimpleNamespace(async_get_entry=lambda _: entry),
        )
        request = make_mocked_request("GET", "/", app={KEY_HASS: hass})
        request[KEY_HASS_USER] = SimpleNamespace(is_admin=True)
        view = ImportedThumbnailView()
        with pytest.raises(web.HTTPNotFound):
            await view.get(request, entry.entry_id)

        directory = tmp_path / ".storage" / "image_lab.images"
        directory.mkdir(parents=True)
        (directory / key).write_bytes(camera_jpeg())
        first = await view.get(request, entry.entry_id)
        assert first.content_type == "image/jpeg"
        with Image.open(BytesIO(first.body)) as thumbnail:
            assert thumbnail.size == (192, 144)

        Image.new("RGB", (100, 200), "green").save(directory / key, format="PNG")
        second = await view.get(request, entry.entry_id)
        with Image.open(BytesIO(second.body)) as thumbnail:
            assert thumbnail.size == (72, 144)
        entry.data["source_type"] = "camera"
        with pytest.raises(web.HTTPNotFound):
            await view.get(request, entry.entry_id)

    asyncio.run(run())


def test_admin_views_check_permissions_and_profile_type():
    from custom_components.image_lab import CameraZoneView
    from custom_components.image_lab.comparison_api import ComparisonView
    from custom_components.image_lab.meter_api import MeterView

    async def run():
        entry = loaded_entry("palette")
        entry.data["source_type"] = "upload"
        lookup = Mock(return_value=entry)
        hass = SimpleNamespace(config_entries=SimpleNamespace(async_get_entry=lookup))
        request = make_mocked_request("GET", "/", app={KEY_HASS: hass})
        user = SimpleNamespace(is_admin=False)
        request[KEY_HASS_USER] = user
        for view in (ImageLabPreviewView(), ImportedThumbnailView(), CameraZoneView(), MeterView(), ComparisonView()):
            with pytest.raises(web.HTTPForbidden):
                await view.get(request, "profile")
        lookup.assert_not_called()

        user.is_admin = True
        for view in (MeterView(), ComparisonView(), CameraZoneView()):
            with pytest.raises(web.HTTPNotFound):
                await view.get(request, "profile")
        entry.domain = "other_integration"
        with pytest.raises(web.HTTPNotFound):
            await ImageLabPreviewView().get(request, "profile")

    asyncio.run(run())


def test_panel_forms_are_user_flows_and_do_not_appear_in_discovery(tmp_path, monkeypatch):
    from homeassistant import config_entries
    from homeassistant.components.config.config_entries import (
        ConfigManagerFlowIndexView, config_entries_flow_progress,
    )

    from custom_components.image_lab import AnalysisFlowView

    async def run():
        hass = HomeAssistant(str(tmp_path))
        hass.config_entries = config_entries.ConfigEntries(hass, {})
        manager = hass.config_entries.flow
        entry = loaded_entry("palette")
        entry.title = "Cover colors"
        monkeypatch.setattr(hass.config_entries, "async_get_entry", lambda _: entry)
        monkeypatch.setattr(config_entries, "_async_get_flow_handler", AsyncMock(
            return_value=config_flow.ImageLabConfigFlow,
        ))
        panel = AnalysisFlowView(manager)
        standard = ConfigManagerFlowIndexView(manager)
        create = {"handler": "image_lab"}
        edit = {**create, "entry_id": entry.entry_id}
        for context, expected in [
            (panel.get_context(create), "analysis"),
            (panel.get_context(edit), "rename"),
            (standard.get_context(edit), "source"),
        ]:
            result = await manager.async_init("image_lab", context=context)
            assert result["step_id"] == expected

        assert len(manager.async_progress()) == 3
        connection = Mock(user=SimpleNamespace(is_admin=True))
        config_entries_flow_progress(hass, connection, {"id": 1})
        connection.send_result.assert_called_once_with(1, [])
        for flow in manager.async_progress():
            manager.async_abort(flow["flow_id"])

        # The native Add Integration action still installs the empty workspace.
        monkeypatch.setattr(hass.config_entries, "async_get_entry", lambda _: None)
        monkeypatch.setattr(hass.config_entries, "async_add", AsyncMock())
        installed = await manager.async_init("image_lab", context=standard.get_context(create))
        assert installed["type"] == "create_entry"
        assert installed["result"].unique_id == config_flow.INSTALLATION_ID
        assert installed["result"].data == {}

    asyncio.run(run())


@pytest.mark.parametrize("module", ["comparison", "palette", "object_detection", "meter"])
def test_analysis_worker_does_not_block_the_home_assistant_loop(tmp_path, monkeypatch, module):
    import threading

    from custom_components.image_lab import comparison_store, meter
    from custom_components.image_lab.images import get_image_storage

    async def run():
        hass = HomeAssistant(str(tmp_path))
        entry = loaded_entry(module)
        entry.data.update(source_type="upload", image_key="12345678123456781234567812345678")
        entry.data.pop("entity_id")
        hass.config_entries = SimpleNamespace(async_get_entry=lambda _: entry)
        storage = get_image_storage(hass)
        storage.directory.mkdir(parents=True)
        (storage.directory / entry.data["image_key"]).write_bytes(camera_jpeg())

        main_thread = threading.get_ident()
        loop_ran = threading.Event()

        def processor(frame, *_):
            assert threading.get_ident() != main_thread
            hass.loop.call_soon_threadsafe(loop_ran.set)
            assert loop_ran.wait(timeout=2), "Event loop stalled during processing"
            result = ModuleResult({})
            if module == "comparison":
                return result
            if module == "meter":
                return result, None
            return result, frame

        if module == "comparison":
            monkeypatch.setattr(comparison_store, "compare", processor)
        elif module == "palette":
            monkeypatch.setattr(analysis, "extract_palette", processor)
        elif module == "object_detection":
            engine = object_detection.ObjectDetector()
            engine._detector = SimpleNamespace(detect=processor)
            hass.data["image_lab.object_detector"] = engine
        else:
            entry.data["meter_settings"] = {"source": meter.meter_source(entry.data)}
            monkeypatch.setattr(meter, "async_ensure_tarsius", AsyncMock())
            monkeypatch.setattr(meter, "_read", processor)

        result = await analysis.async_analyze(hass, entry.entry_id)
        assert result.response["status"] == "ok"
        assert loop_ran.is_set()

    asyncio.run(run())
