"""Regression tests for comparison decisions and the visual crop used by Tarsius."""

import json
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw, ImageOps

from custom_components.image_lab.comparison import compare
from custom_components.image_lab.comparison_store import ComparisonStore
from custom_components.image_lab.comparison_tarsius import (
    oriented_for_tarsius,
    compare_tarsius,
    detector_for,
)
from custom_components.image_lab.images import validate_image


def png(image, **options):
    buffer = BytesIO()
    image.save(buffer, format="PNG", **options)
    return buffer.getvalue()


def test_thresholds_use_full_precision(tmp_path):
    source = Image.new("L", (320, 240))
    exact = png(source)
    source.putpixel((160, 120), 255)
    (tmp_path / "different").write_bytes(png(source))
    (tmp_path / "exact").write_bytes(exact)
    gallery = {
        "settings": {"region": None, "max_distance": 0, "min_margin": 0},
        "states": [{"id": "a", "name": "A"}, {"id": "z", "name": "Z"}],
        "references": [
            {"id": "different", "state_id": "a", "name": "A"},
            {"id": "exact", "state_id": "z", "name": "Z"},
        ],
    }
    frame = validate_image(exact)
    result = compare(frame, gallery, tmp_path)
    assert result.data["scores"] == {"A": 0.0, "Z": 0.0}
    assert result.data["state"] == "Z"

    gallery["settings"]["min_margin"] = 0.01
    assert compare(frame, gallery, tmp_path).reason == "ambiguous"
    gallery["references"].pop()
    assert compare(frame, gallery, tmp_path).reason == "distance_too_high"


def test_tarsius_uses_displayed_coordinates():
    image = Image.new("RGB", (8, 12))
    image.putpixel((2, 3), (255, 0, 0))
    original = png(image)
    assert oriented_for_tarsius(original, 1024) is original
    for orientation in range(2, 9):
        exif = Image.Exif()
        exif[274] = orientation
        encoded = png(image, exif=exif)
        with Image.open(BytesIO(encoded)) as source:
            expected = ImageOps.exif_transpose(source)
        with Image.open(BytesIO(oriented_for_tarsius(encoded, 1024))) as actual:
            assert actual.size == expected.size
            assert actual.tobytes() == expected.tobytes()


def test_engine_setting_is_backward_compatible(tmp_path):
    hass = SimpleNamespace(
        config=SimpleNamespace(path=lambda *parts: tmp_path.joinpath(*parts))
    )
    store = ComparisonStore(hass, "profile")
    gallery = store.load()
    old_settings = {"region": None, "max_distance": 10, "min_margin": 1}
    gallery["settings"] = old_settings
    store.directory.mkdir(parents=True)
    store.manifest.write_text(json.dumps({"version": 1, "data": gallery}))
    assert store.load()["settings"]["engine"] == "pillow"
    store._apply("settings", {**old_settings, "engine": "tarsius"}, None)
    store._apply("settings", old_settings, None)
    assert store.load()["settings"]["engine"] == "tarsius"


def test_tarsius_uses_training_images_and_preserves_state_ids(tmp_path):
    pytest.importorskip("tarsius")
    for name, box in (("open", (8, 14, 35, 110)), ("closed", (8, 14, 110, 35))):
        image = Image.new("RGB", (128, 128))
        ImageDraw.Draw(image).rectangle(box, fill="white")
        (tmp_path / name).write_bytes(png(image))

    gallery = {
        "settings": {
            "engine": "tarsius",
            "region": None,
            "max_distance": 0,
            "min_margin": 255,
        },
        "states": [{"id": "a", "name": "Ouvert"}, {"id": "b", "name": "Fermé"}],
        "references": [
            {"id": "open", "state_id": "a"},
            {"id": "closed", "state_id": "b"},
        ],
    }
    frame = validate_image((tmp_path / "open").read_bytes())
    detector = detector_for(gallery, tmp_path)
    result = compare_tarsius(frame, gallery, tmp_path)
    assert result.reason is None
    assert result.data["state_id"] == "a"
    assert result.data["reference_id"] == "open"
    assert result.data["scores"]["Ouvert"] > result.data["scores"]["Fermé"]
    gallery["states"][0]["name"] = "Ouverte"
    assert detector_for(gallery, tmp_path) is detector
    assert compare_tarsius(frame, gallery, tmp_path).data["state"] == "Ouverte"
    gallery["settings"]["region"] = {"x": 0, "y": 0, "width": 0.8, "height": 0.8}
    assert detector_for(gallery, tmp_path) is not detector
    gallery["references"].pop()
    assert (
        compare_tarsius(frame, gallery, tmp_path).reason == "tarsius_needs_references"
    )
