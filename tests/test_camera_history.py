"""Regression checks for bounded camera history and shared multi-zone analysis."""

import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from PIL import Image

from custom_components.image_lab import output
from custom_components.image_lab.comparison_store import ComparisonStore
from custom_components.image_lab.images import ImageError, crop_frame, validate_image
from custom_components.image_lab.result_store import ResultStore


def two_colors():
    image = Image.new("RGB", (12, 6), "red")
    image.paste("blue", (6, 0, 12, 6))
    content = BytesIO()
    image.save(content, "PNG")
    return validate_image(content.getvalue())


def test_history_filters_rotates_and_preserves_corrected_images(tmp_path):
    store = ComparisonStore(
        SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath)), "test"
    )
    frame = two_colors()
    data = store._apply("state", {"name": "Open"}, None)
    assert data["history_settings"] == {"limit": 10, "mode": "all"}
    state = data["states"][0]["id"]
    known = {"status": "ok", "data": {"state_id": state, "state": "Open", "engine": "pillow"}}
    unknown = {"status": "unknown", "reason": "ambiguous", "data": {"state": "unknown", "engine": "pillow"}}

    data = store._apply("history_settings", {"mode": "changes", "limit": 3}, None)
    for result in (known, known, unknown, unknown):
        store._record(frame, result, manual=False)
    first, second, third = [item["id"] for item in store.load()["history"]]
    target = {"capture_id": first, "state_id": state}
    data = store._apply("correct", target, None)
    # Existing validation images keep their original bytes and assigned state.
    data["references"][0]["validation"] = True
    store._save(data)
    assert store.load()["references"] == [
        {"id": first, "name": data["history"][0]["time"], "state_id": state}
    ]
    data = store._apply("correct", target, None)
    assert len(data["references"]) == 1
    data = store._apply("history_settings", {"mode": "changes", "limit": 1}, None)
    assert [item["id"] for item in data["history"]] == [third]
    assert {p.name for p in store.images.iterdir()} == {first, third}
    assert store._image(first, False).content == frame.content
    assert not (store.images / second).exists()
    data = store._apply("history_settings", {"mode": "off", "limit": 1}, None)
    newest = store._record(frame, known, manual=False)
    assert store.load()["history"] == data["history"]
    assert store._image(newest["id"], False).content == frame.content
    manual = store._record(frame, known, manual=True)
    assert [item["id"] for item in store.load()["history"]] == [manual["id"]]
    assert not (store.images / newest["id"]).exists()
    assert store._latest(store.load()) == manual
    store._apply("delete", {"reference_id": first}, None)
    assert not (store.images / first).exists()


def test_history_write_error_does_not_leave_an_original(tmp_path):
    store = ComparisonStore(
        SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath)), "test"
    )
    frame = two_colors()
    with patch.object(store, "_save", side_effect=OSError), pytest.raises(OSError):
        store._record(
            frame, {"status": "unknown", "data": {"engine": "pillow"}}, manual=True
        )
    assert not list(store.images.iterdir())


def test_same_camera_and_different_schedules_share_due_frames():
    async def run():
        source = two_colors()
        hass = SimpleNamespace(async_create_task=asyncio.create_task, data={})
        schedule = output.CameraSchedule(hass)
        groups = []
        for minutes, x in ((1, 0.0), (2, 0.5)):

            async def process(future, x=x):
                frame = await future
                region = {"x": x, "y": 0, "width": 0.5, "height": 1}
                crop = crop_frame(frame, region)
                with Image.open(BytesIO(crop.content)) as image:
                    assert image.size == (6, 6)
                    assert image.getpixel((0, 0)) == (
                        (255, 0, 0) if x == 0 else (0, 0, 255)
                    )

            coordinator = Mock()
            coordinator.config_entry.data = {"entity_id": "camera.example"}
            coordinator.async_process_capture = AsyncMock(side_effect=process)
            schedule.profiles[coordinator] = minutes
            groups.append(coordinator)
        with (
            patch.object(
                output, "async_get_frame", AsyncMock(return_value=source)
            ) as acquire,
            patch.object(
                output, "resolve_entity_id", side_effect=lambda hass, entity: entity
            ),
        ):
            for _ in range(2):
                await schedule.tick(None)
        assert acquire.await_count == 2
        left, right = groups
        assert left.async_process_capture.await_count == 2
        assert right.async_process_capture.await_count == 1
        assert (
            left.async_process_capture.await_args.args[0]
            is right.async_process_capture.await_args.args[0]
        )
        for profile in groups:
            profile.async_set_update_error.assert_not_called()

    asyncio.run(run())


def test_latest_result_is_restored_and_history_is_bounded(tmp_path):
    hass = SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath))
    store = ResultStore(hass, "palette")
    frame = two_colors()
    response = {"status": "ok", "data": {"palette_rgb": [[255, 0, 0]]}}
    first = store._record(frame, response, manual=False)
    for _ in range(9):
        store._record(frame, response, manual=False)
    latest = store._record(frame, response, manual=True)

    restored = ResultStore(hass, "palette")
    assert restored._read(None) == restored._read(latest["id"]) == (latest, frame)
    assert restored._read(first["id"]) is None
    assert len(list(restored.images.iterdir())) == 10


def test_disabling_automatic_history_keeps_the_latest_and_manual_frames(tmp_path):
    hass = SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath))
    store = ResultStore(hass, "objects")
    frame = two_colors()
    response = {"status": "ok", "data": {"count": 0}}
    expired = store._record(frame, response, manual=False)
    manual = store._record(frame, response, manual=True)
    store._set_history_settings(store.load(), {"mode": "off", "limit": 1})
    automatic = store._record(frame, response, manual=False)

    assert store._read(expired["id"]) is None
    assert store._read(automatic["id"]) is None
    assert store._read(None) == (automatic, frame)
    assert store._read(manual["id"]) == (manual, frame)
    _, thumbnail = store._read(manual["id"], thumbnail=True)
    assert thumbnail.content_type == "image/jpeg"


def test_reuses_thumbnail_until_original_changes(tmp_path):
    hass = SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath))
    store = ResultStore(hass, "palette")
    frame = two_colors()
    capture = store._record(frame, {"status": "ok", "data": {}}, manual=True)
    image_id = capture["id"]

    _, thumbnail = store._read(image_id, thumbnail=True)
    assert store._read(image_id, thumbnail=True)[1] is thumbnail
    assert store._read(image_id)[1] == frame

    original = store.images / image_id
    cropped = crop_frame(frame, {"x": 0, "y": 0, "width": 0.5, "height": 1})
    original.write_bytes(cropped.content)
    assert store._read(image_id, thumbnail=True)[1].width == 6
    original.unlink()
    with pytest.raises(ImageError, match="storage_error"):
        store._read(image_id, thumbnail=True)


def test_latest_comparison_can_use_an_older_history_format(tmp_path):
    hass = SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath))
    store = ComparisonStore(hass, "camera")
    frame = two_colors()
    observed = store._record(frame, {
        "status": "ok",
        "data": {"state_id": "closed", "state": "Closed", "engine": "pillow"},
    }, manual=False)
    legacy = store.load()
    del legacy["latest"]
    del legacy["history"][0]["manual"]
    store._save(legacy)
    newest, restored_frame = store._read(None)
    assert newest["id"] == observed["id"]
    assert newest["response"]["data"]["state"] == "Closed"
    assert restored_frame == frame
    gallery, latest = store.load_with_latest()
    assert gallery == legacy
    assert latest == newest

    (store.images / observed["id"]).unlink()
    gallery, latest = store.load_with_latest()
    assert gallery == legacy
    assert isinstance(latest, ImageError)
    assert latest.reason == "reference_not_found"
