"""Compare normalized grayscale crops against labelled image references."""

from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import TypedDict

from PIL import Image, ImageChops, ImageOps, ImageStat
from PIL.ImageFilter import GaussianBlur

from .images import ImageError, ImageFrame, read_image_file, validate_image

MAX_COMPARE_SIZE = (640, 360)
Bounds = tuple[float, float, float, float]


class Region(TypedDict):
    """A rectangle relative to the oriented image dimensions."""

    x: float
    y: float
    width: float
    height: float


class Settings(TypedDict):
    """Image comparison parameters."""

    region: Region | None
    max_distance: float
    min_margin: float


class State(TypedDict):
    """A labelled state with a stable internal identifier."""

    id: str
    name: str


class Reference(TypedDict):
    """Metadata for one reference or validation image."""

    id: str
    state_id: str
    name: str
    validation: bool


class ComparisonData(TypedDict):
    """Persisted settings and gallery for one analysis."""

    settings: Settings
    states: list[State]
    references: list[Reference]


@dataclass(frozen=True)
class ComparisonResult:
    """Comparison output for the panel and action."""

    data: dict
    reason: str | None = None


def _crop(image: Image.Image, bounds: Bounds | None) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if bounds is None:
        return image

    left, top, span_x, span_y = bounds
    width, height = image.size
    x = min(width - 1, round(left * width))
    y = min(height - 1, round(top * height))
    right = max(x + 1, round((left + span_x) * width))
    bottom = max(y + 1, round((top + span_y) * height))
    return image.crop((x, y, min(right, width), min(bottom, height)))


def _preprocess(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    # Match the Pyscript: resize first, then grayscale and blur.
    return (
        image.resize(size, Image.Resampling.LANCZOS)
        .convert("L")
        .filter(GaussianBlur(radius=3))
    )


@lru_cache(maxsize=96)
def _reference_features(
    path: Path, bounds: Bounds | None, size: tuple[int, int]
) -> Image.Image:
    """Reuse small grayscale images when the same immutable reference is tested."""
    original = validate_image(read_image_file(path))
    with Image.open(BytesIO(original.content)) as image:
        return _preprocess(_crop(image, bounds), size)


def compare(
    frame: ImageFrame, gallery: ComparisonData, images: Path
) -> ComparisonResult:
    """Use the best reference per state, then apply the distance and margin thresholds."""
    settings = gallery["settings"]
    region = settings["region"]
    bounds = (
        (region["x"], region["y"], region["width"], region["height"])
        if region
        else None
    )
    with Image.open(BytesIO(frame.content)) as image:
        crop = _crop(image, bounds)
        width, height = crop.size
        scale = min(1, MAX_COMPARE_SIZE[0] / width, MAX_COMPARE_SIZE[1] / height)
        size = (max(1, int(width * scale)), max(1, int(height * scale)))
        query = _preprocess(crop, size)

    names = {state["id"]: state["name"] for state in gallery["states"]}
    counts = dict.fromkeys(names.values(), 0)
    scores: dict[str, float] = {}
    closest: dict[str, tuple[float, Reference]] = {}

    for reference in gallery["references"]:
        if reference["validation"]:
            continue
        label = names[reference["state_id"]]
        try:
            ref = _reference_features(images / reference["id"], bounds, size)
        except (OSError, ImageError):
            continue

        counts[label] += 1
        distance = ImageStat.Stat(ImageChops.difference(query, ref)).mean[0]
        if label not in closest or distance < closest[label][0]:
            closest[label] = (distance, reference)
            scores[label] = round(distance, 2)

    data = {
        "state": "unknown",
        "scores": scores,
        "ref_counts": counts,
        "confidence": 0.0,
        "best_state": None,
        "distance": None,
        "margin": None,
        "reference_id": None,
    }
    if not scores:
        return ComparisonResult(data, "no_references")

    ranking = sorted(scores, key=lambda label: (scores[label], label))
    best = ranking[0]
    distance = scores[best]
    margin = round(scores[ranking[1]] - distance, 2) if len(ranking) > 1 else None
    data.update(
        best_state=best,
        distance=distance,
        margin=margin,
        confidence=margin if margin is not None else 0.0,
        reference_id=closest[best][1]["id"],
    )
    if distance > settings["max_distance"]:
        return ComparisonResult(data, "distance_too_high")
    if margin is not None and (margin == 0 or margin < settings["min_margin"]):
        return ComparisonResult(data, "ambiguous")
    data["state"] = best
    return ComparisonResult(data)
