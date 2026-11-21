"""Regression tests for comparison decisions and the visual crop used by Tarsius."""

from io import BytesIO

from PIL import Image, ImageOps

from custom_components.image_lab.comparison import compare
from custom_components.image_lab.comparison_benchmark import _tarsius_image
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
            {"id": "different", "state_id": "a", "name": "A", "validation": False},
            {"id": "exact", "state_id": "z", "name": "Z", "validation": False},
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
    assert _tarsius_image(original, 1024) is original
    for orientation in range(2, 9):
        exif = Image.Exif()
        exif[274] = orientation
        encoded = png(image, exif=exif)
        with Image.open(BytesIO(encoded)) as source:
            expected = ImageOps.exif_transpose(source)
        with Image.open(BytesIO(_tarsius_image(encoded, 1024))) as actual:
            assert actual.size == expected.size
            assert actual.tobytes() == expected.tobytes()
