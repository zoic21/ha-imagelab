"""Regression checks for bounded camera history and shared multi-zone analysis."""

import asyncio
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from PIL import Image, JpegImagePlugin

from custom_components.image_lab import images, output
from custom_components.image_lab.comparison_store import ComparisonStore
from custom_components.image_lab.images import ImageError, analysis_pixels, validate_image
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
    assert data["history_settings"] == {"limit": 10, "mode": "changes"}
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
    data["references"][0].pop("source")
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


def test_comparison_history_default_preserves_saved_mode(tmp_path):
    store = ComparisonStore(
        SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath)), "test"
    )
    data = store.load()
    data.pop("history_settings")
    store._save(data)
    assert store.load()["history_settings"] == {"mode": "changes", "limit": 10}
    store._apply("history_settings", {"mode": "all", "limit": 15}, None)
    assert store.load()["history_settings"] == {"mode": "all", "limit": 15}


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
                with analysis_pixels(frame, region) as (image, crop):
                    assert crop.width == image.width
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
    with analysis_pixels(frame, {"x": 0, "y": 0, "width": 0.5, "height": 1}) as (_, cropped):
        original.write_bytes(cropped.content)
    assert store._read(image_id, thumbnail=True)[1].width == 6
    original.unlink()
    with pytest.raises(ImageError, match="storage_error"):
        store._read(image_id, thumbnail=True)


@pytest.mark.parametrize(("orientation", "size"), [(1, (240, 135)), (6, (81, 144))])
def test_jpeg_thumbnails_decode_at_reduced_size(tmp_path, monkeypatch, orientation, size):
    path = tmp_path / "capture"
    source = Image.new("RGB", (1601, 903), "red")
    source.paste("blue", (800, 0, 1601, 903))
    exif = Image.Exif()
    exif[Image.ExifTags.Base.Orientation] = orientation
    source.save(path, "JPEG", exif=exif)
    frame = validate_image(path.read_bytes())
    assert (frame.width, frame.height) == source.size

    with patch.object(images, "MAX_IMAGE_PIXELS", 1_000_000):
        with pytest.raises(ImageError, match="image_too_large"):
            images.read_thumbnail(path)

    decoded_sizes = []
    load = JpegImagePlugin.JpegImageFile.load

    def track_load(image):
        if image.tile:
            decoded_sizes.append(image.size)
        return load(image)

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "load", track_load)
    stored = images.read_thumbnail(path)
    assert stored == images.thumbnail_frame(frame)
    assert len(decoded_sizes) == 2
    assert all(width < source.width and height < source.height for width, height in decoded_sizes)
    assert (stored.width, stored.height) == size
    with Image.open(BytesIO(stored.content)) as thumbnail:
        assert thumbnail.size == size
        assert thumbnail.getpixel((10, 10))[0] > 240
        blue_point = (10, thumbnail.height - 10) if orientation == 6 else (thumbnail.width - 10, 10)
        assert thumbnail.getpixel(blue_point)[2] > 240


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


def test_classifying_the_same_capture_from_result_and_history_moves_it(tmp_path):
    store = ComparisonStore(SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath)), "profile")
    frame = two_colors()
    closed = store._apply("state", {"name": "Closed"}, None)["states"][0]["id"]
    opened = store._apply("state", {"name": "Open"}, None)["states"][1]["id"]
    observation = store._record(frame, {"status": "unknown", "data": {"engine": "pillow"}}, True)
    target = {"capture_id": observation["id"], "name": "Capture 23/11/2026 09:12:38"}
    store._apply("add", {**target, "state_id": closed}, None)
    store._apply("correct", {**target, "state_id": opened}, None)
    gallery = store._apply("add", {**target, "state_id": opened}, None)
    assert [r["id"] for r in gallery["references"]] == [observation["id"]]
    assert store._run(frame, gallery)[0].data["state"] == "Open"

    # A copy created before IDs were shared can already coexist with the history reference.
    legacy = {"id": "old-copy", "state_id": closed, "name": target["name"]}
    (store.images / legacy["id"]).write_bytes(frame.content)
    gallery["latest"]["response"]["data"]["reference_id"] = legacy["id"]
    gallery["references"].append(legacy)
    store._save(gallery)
    gallery = store._apply("correct", {**target, "state_id": opened}, None)
    assert len(gallery["references"]) == 1
    assert store._run(frame, gallery)[0].data["state"] == "Open"
    assert gallery["latest"]["response"]["data"]["reference_id"] == observation["id"]
    assert [p.name for p in store.images.iterdir()] == [observation["id"]]

    with patch("custom_components.image_lab.comparison_store.read_upload", return_value=frame):
        store._apply("add", {"upload_id": "upload", "state_id": opened, "name": target["name"]}, None)
    gallery = store._apply("correct", {**target, "state_id": opened}, None)
    assert [r["source"] for r in gallery["references"]] == ["capture", "upload"]


def test_stored_zone_thumbnail_uses_pixel_limit_and_imports_keep_byte_limit(tmp_path, monkeypatch):
    from custom_components.image_lab.palette import extract_palette

    source = two_colors()
    result, crop = extract_palette(source, 1, {"x": 0.5, "y": 0, "width": 0.5, "height": 1})
    assert result.data["dominant_hex"] == "#0000FF"
    path = tmp_path / "archived"
    path.write_bytes(crop.content)
    monkeypatch.setattr(images, "MAX_IMAGE_BYTES", len(crop.content) - 1)
    with pytest.raises(ImageError, match="image_too_large"):
        validate_image(crop.content)
    assert images.read_thumbnail(path).width == 6
    monkeypatch.setattr(images, "MAX_IMAGE_PIXELS", 1)
    path.touch()
    with pytest.raises(ImageError, match="image_too_large"):
        images.read_thumbnail(path)
