"""Tarsius comparison."""

from __future__ import annotations

from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING

from homeassistant.core import HomeAssistant
from homeassistant.requirements import RequirementsNotFound, async_process_requirements
from PIL import Image, ImageOps

from .comparison import ComparisonData
from .const import DOMAIN
from .images import Bounds, ImageError, ImageFrame, read_image_file, validate_image
from .models import ModuleResult

if TYPE_CHECKING:
    from tarsius import Result, StateDetector

TARSIUS_REQUIREMENT = "tarsius==0.5.3"


async def async_ensure_tarsius(hass: HomeAssistant) -> None:
    try:
        await async_process_requirements(
            hass, DOMAIN, [TARSIUS_REQUIREMENT], is_built_in=False
        )
    except RequirementsNotFound as err:
        raise ImageError("tarsius_unavailable") from err


def _tarsius_image(content: bytes, max_side: int) -> bytes:
    """Apply the displayed orientation before Tarsius interprets the crop."""
    with Image.open(BytesIO(content)) as image:
        if image.getexif().get(Image.ExifTags.Base.Orientation, 1) not in range(2, 9):
            return content
        image.thumbnail((max_side, max_side))
        oriented = ImageOps.exif_transpose(image).convert("RGB")
        buffer = BytesIO()
        oriented.save(buffer, "PNG")
        return buffer.getvalue()


def detector_for(gallery: ComparisonData, images: Path) -> StateDetector:
    states = tuple(state["id"] for state in gallery["states"])
    references = tuple(
        (ref["id"], ref["state_id"])
        for ref in gallery["references"]
    )
    if len(states) < 2 or set(states) != {state for _, state in references}:
        raise ImageError("tarsius_needs_references")
    region = gallery["settings"]["region"]
    bounds = (
        (
            region["x"],
            region["y"],
            min(1, region["x"] + region["width"]),
            min(1, region["y"] + region["height"]),
        )
        if region
        else None
    )
    return _prepare_detector(images, states, references, bounds)


@lru_cache(maxsize=4)
def _prepare_detector(
    images: Path,
    states: tuple[str, ...],
    references: tuple[tuple[str, str], ...],
    bounds: Bounds | None,
) -> StateDetector:
    """Reuse the prepared index while the crop and immutable reference images match."""
    try:
        import tarsius
    except (ImportError, OSError) as err:
        raise ImageError("tarsius_unavailable") from err
    try:
        roi = tarsius.Roi(*bounds) if bounds else tarsius.Roi()
        detector = tarsius.StateDetector(roi, states, max_per_state=len(references))
        for ref, state in references:
            try:
                original = validate_image(read_image_file(images / ref))
                prepared = detector.prepare(
                    _tarsius_image(original.content, detector.frame_side)
                )
            except (ImageError, OSError, tarsius.BlankRegionError, tarsius.ImageError):
                continue
            detector.add(ref, prepared, state=state)
    except tarsius.RoiError as err:
        raise ImageError("invalid_settings") from err
    except tarsius.BackendError as err:
        raise ImageError("tarsius_unavailable") from err
    if not detector.ready:
        raise ImageError("tarsius_needs_references")
    return detector


def predict(detector: StateDetector, frame: ImageFrame) -> Result:
    import tarsius

    try:
        return detector.classify(_tarsius_image(frame.content, detector.frame_side))
    except tarsius.BlankRegionError as err:
        raise ImageError("blank_region") from err
    except tarsius.BackendError as err:
        raise ImageError("tarsius_unavailable") from err
    except (OSError, tarsius.ImageError) as err:
        raise ImageError("invalid_image") from err


def compare_tarsius(
    frame: ImageFrame, gallery: ComparisonData, images: Path
) -> ModuleResult:
    names = {state["id"]: state["name"] for state in gallery["states"]}
    counts = dict.fromkeys(names.values(), 0)
    data = {"state": "unknown", "ref_counts": counts}
    try:
        detector = detector_for(gallery, images)
        counts.update({names[key]: value for key, value in detector.counts().items()})
        prediction = predict(detector, frame)
    except ImageError as err:
        if err.reason in ("tarsius_needs_references", "blank_region"):
            return ModuleResult(data, err.reason)
        raise

    best = prediction.candidate
    data.update(
        best_state=names.get(best),
        reference_id=prediction.nearest.get(best),
        scores={
            names[key]: round(value, 4) for key, value in prediction.scores.items()
        },
        margin=round(prediction.margin, 4),
        confidence=round(prediction.probabilities.get(best, 0.0), 4),
        distance=None,
    )
    if prediction.state is None:
        return ModuleResult(data, "ambiguous")
    data.update(state=names[prediction.state], state_id=prediction.state)
    return ModuleResult(data)
