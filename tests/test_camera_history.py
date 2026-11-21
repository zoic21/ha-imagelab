"""Regression checks for bounded camera history and shared multi-zone analysis."""

import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from PIL import Image

from custom_components.image_lab import output
from custom_components.image_lab.comparison_store import ComparisonStore
from custom_components.image_lab.images import crop_frame, validate_image
from custom_components.image_lab.models import ModuleResult


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
    known = ModuleResult({"state_id": state, "state": "Open"})
    unknown = ModuleResult({"state": "unknown"}, "ambiguous")

    data = store._apply("history_settings", {"mode": "changes", "limit": 3}, None)
    for result in (known, known, unknown, unknown):
        store._record(data, frame, result)
    first, second, third = [item["id"] for item in data["history"]]
    target = {"capture_id": first, "state_id": state, "validation": True}
    for validation in (True, False):
        data = store._apply("correct", {**target, "validation": validation}, None)
        assert (
            len(data["references"]) == 1
            and data["references"][0]["validation"] is validation
        )
    data = store._apply("history_settings", {"mode": "changes", "limit": 1}, None)
    assert [item["id"] for item in data["history"]] == [third]
    assert {p.name for p in store.images.iterdir()} == {first, third}
    assert store._image(first, False).content == frame.content
    assert not (store.images / second).exists()
    data = store._apply("history_settings", {"mode": "off", "limit": 1}, None)
    store._record(data, frame, known)
    assert store.load()["history"] == data["history"]
    store._apply("delete", {"reference_id": first}, None)
    assert not (store.images / first).exists()


def test_history_write_error_does_not_leave_an_original(tmp_path):
    store = ComparisonStore(
        SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath)), "test"
    )
    frame = two_colors()
    with patch.object(store, "_save", side_effect=OSError), pytest.raises(OSError):
        store._record(
            store.load(), frame, ModuleResult({"state": "unknown"}, "ambiguous")
        )
    assert not list(store.images.iterdir())


def test_same_camera_and_different_schedules_share_due_frames():
    async def run():
        source = two_colors()
        hass = SimpleNamespace(async_create_task=asyncio.create_task)
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
