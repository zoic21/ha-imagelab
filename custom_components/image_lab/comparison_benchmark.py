"""Evaluate the two comparison engines against the same labelled captures."""

from pathlib import Path
from statistics import median
from time import perf_counter
from typing import Literal, TypedDict

from .comparison import ComparisonData, compare
from .images import ImageError, read_image_file, validate_image

TARSIUS_REQUIREMENT = "tarsius==0.5.3"
Outcome = Literal["correct", "wrong", "unknown", "error"]


class Measurement(TypedDict):
    outcome: Outcome
    state: str | None
    duration_ms: float | None


class Sample(TypedDict):
    name: str
    expected: str
    pillow: Measurement
    tarsius: Measurement


def _measurement(state: str | None, expected: str, started: float) -> Measurement:
    outcome: Outcome = "unknown"
    if state is not None:
        outcome = "correct" if state == expected else "wrong"
    return {
        "outcome": outcome,
        "state": state,
        "duration_ms": (perf_counter() - started) * 1000,
    }


def _summary(measurements: list[Measurement]) -> dict:
    counts = dict.fromkeys(("correct", "wrong", "unknown", "error"), 0)
    durations = []
    for measurement in measurements:
        counts[measurement["outcome"]] += 1
        if measurement["duration_ms"] is not None:
            durations.append(measurement["duration_ms"])
    return {**counts, "median_ms": round(median(durations), 1) if durations else None}


def run_benchmark(gallery: ComparisonData, images: Path) -> dict:
    """Prepare reference features, then time each engine on held-out images."""
    validation = [ref for ref in gallery["references"] if ref["validation"]]
    if not validation:
        raise ImageError("no_validation_images")
    states = {state["id"]: state["name"] for state in gallery["states"]}
    references = [ref for ref in gallery["references"] if not ref["validation"]]
    if len(states) < 2 or not states.keys() <= {ref["state_id"] for ref in references}:
        raise ImageError("benchmark_needs_references")

    try:
        from tarsius import (
            BackendError,
            BlankRegionError,
            ImageError as TarsiusImageError,
            Roi,
            RoiError,
            StateDetector,
            Status,
        )
    except (ImportError, OSError) as err:
        raise ImageError("tarsius_unavailable") from err

    region = gallery["settings"]["region"]
    try:
        roi = (
            Roi(
                region["x"],
                region["y"],
                min(1, region["x"] + region["width"]),
                min(1, region["y"] + region["height"]),
            )
            if region
            else Roi()
        )
    except RoiError as err:
        raise ImageError("invalid_settings") from err

    try:
        detector = StateDetector(roi, tuple(states), max_per_state=len(references))
        for ref in references:
            try:
                original = validate_image(read_image_file(images / ref["id"]))
                prepared = detector.prepare(original.content)
            except (ImageError, OSError, BlankRegionError, TarsiusImageError):
                continue
            detector.add(ref["id"], prepared, state=ref["state_id"])
    except BackendError as err:
        raise ImageError("tarsius_unavailable") from err
    if not detector.ready:
        raise ImageError("benchmark_needs_references")

    error: Measurement = {"outcome": "error", "state": None, "duration_ms": None}
    samples: list[Sample] = []
    warmed_up = False
    for ref in validation:
        expected = states[ref["state_id"]]
        sample: Sample = {
            "name": ref["name"],
            "expected": expected,
            "pillow": error,
            "tarsius": error,
        }
        samples.append(sample)
        try:
            frame = validate_image(read_image_file(images / ref["id"]))
        except (ImageError, OSError):
            continue

        if not warmed_up:
            compare(frame, gallery, images)
            warmed_up = True

        started = perf_counter()
        result = compare(frame, gallery, images)
        sample["pillow"] = _measurement(
            None if result.reason else result.data["state"], expected, started
        )

        started = perf_counter()
        try:
            prediction = detector.classify(frame.content)
        except (BackendError, BlankRegionError, TarsiusImageError):
            continue
        state = (
            states[prediction.state]
            if prediction.status is Status.CONFIDENT and prediction.state is not None
            else None
        )
        sample["tarsius"] = _measurement(state, expected, started)

    return {
        "pillow": _summary([sample["pillow"] for sample in samples]),
        "tarsius": _summary([sample["tarsius"] for sample in samples]),
        "images": samples,
        "tarsius_references_skipped": len(references) - sum(detector.counts().values()),
    }
