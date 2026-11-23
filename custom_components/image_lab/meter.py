"""Read a mechanical meter locally with Tarsius."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from statistics import fmean
from typing import TYPE_CHECKING, Any

from homeassistant.const import CONF_ENTITY_ID
from homeassistant.core import HomeAssistant
from PIL import Image, ImageOps

from .comparison_tarsius import async_ensure_tarsius, oriented_for_tarsius
from .const import CONF_SOURCE_TYPE
from .images import ImageError, ImageFrame, Region
from .models import ModuleResult

if TYPE_CHECKING:
    from tarsius.meter import MeterLayout, MeterReader, MeterReading

METER = "meter"
METER_OUTPUT = "meter_index"
METER_SETTINGS = "meter_settings"
METER_SEED = "meter_seed"
METER_TOTAL_OFFSET = "total_offset"
METER_UNITS = {"water": "m³", "gas": "m³", "energy": "kWh"}

_CONTRAST_CALIBRATION = "wheel_contrast"
_LOW_WHEEL_SPREAD = 25.0
_MIN_WHEEL_CONFIDENCE_GAIN = 0.10


def meter_source(settings: Mapping[str, Any]) -> str:
    """Identify the camera while allowing successive imports of the same meter."""
    source = settings[CONF_SOURCE_TYPE]
    return f"{source}/{settings.get(CONF_ENTITY_ID, '')}"


def _roi(region: Region):
    from tarsius import Roi

    x, y = region["x"], region["y"]
    return Roi(x, y, min(1, x + region["width"]), min(1, y + region["height"]))


def _contrast_frame(content: bytes, layout: MeterLayout) -> tuple[Image.Image, MeterLayout]:
    """Stretch the color channels inside the wheel strip in preview coordinates."""
    from tarsius.meter.frame import decode_frame

    frame = decode_frame(content)
    if layout.rotation:
        frame = frame.rotate(layout.rotation, Image.Resampling.BILINEAR)
        layout = replace(layout, rotation=0)
    box = layout.digits.box(frame.size)
    frame.paste(ImageOps.autocontrast(frame.crop(box), cutoff=1), box[:2])
    return frame, layout


def _observe_meter(
    reader: MeterReader, content: bytes, layout: MeterLayout, saved: dict | None
) -> tuple[MeterReading, dict | None]:
    from tarsius.meter import Calibration

    if saved is not None:
        raw = reader.read(content, layout, Calibration.from_dict(saved))
        contrast = saved.get(_CONTRAST_CALIBRATION)
        # Inspect the raw exposure first so contrast cannot hide glare or a blank crop.
        if contrast is None or raw.faults:
            return raw, None
        frame, oriented = _contrast_frame(content, layout)
        return reader.read(frame, oriented, Calibration.from_dict(contrast)), None

    calibration = reader.calibrate(content, layout)
    raw = reader.read(content, layout, calibration)
    saved = calibration.as_dict()
    spread = fmean(sample.spread for sample in calibration.exposure[: layout.wheels])
    confidence = fmean(wheel.confidence for wheel in raw.wheels)
    if raw.faults or spread >= _LOW_WHEEL_SPREAD or confidence >= 1 - _MIN_WHEEL_CONFIDENCE_GAIN:
        return raw, saved

    frame, oriented = _contrast_frame(content, layout)
    contrast = reader.calibrate(frame, oriented)
    reading = reader.read(frame, oriented, contrast)
    improved = fmean(wheel.confidence for wheel in reading.wheels)
    if reading.accepted and improved >= confidence + _MIN_WHEEL_CONFIDENCE_GAIN:
        return reading, {**saved, _CONTRAST_CALIBRATION: contrast.as_dict()}
    return raw, saved


def _read(
    frame: ImageFrame, settings: dict, state: dict | None, calibrate: bool
) -> tuple[ModuleResult, dict | None]:
    """Run the blocking reader. Calibration is only performed in the editor."""
    try:
        import tarsius
        from tarsius.meter import (
            METER_FRAME_SIDE,
            Dial,
            MeterLayout,
            MeterReader,
            Plausibility,
            PlausibilityState,
            Rejection,
        )
    except (ImportError, OSError) as err:
        raise ImageError("tarsius_unavailable") from err

    try:
        layout = MeterLayout(
            digits=_roi(settings["digits"]),
            wheels=settings["wheels"],
            decimal_wheels=settings["decimal_wheels"],
            rotation=settings["rotation"],
            dials=tuple(
                Dial(_roi(dial["region"]), counterclockwise=dial["counterclockwise"])
                for dial in settings["dials"]
            ),
        )
        content = oriented_for_tarsius(frame.content, METER_FRAME_SIDE)
        reading, calibration = _observe_meter(
            MeterReader(), content, layout, None if calibrate else settings["calibration"]
        )
        if calibrate:
            return _result(reading, settings), calibration

        previous = PlausibilityState.from_dict(state) if state is not None else None
        guard = Plausibility(
            state=previous,
            max_rate=settings["max_rate"],
            tolerance=10.0**-(layout.decimals + 1),
            period=layout.period,
        )
        reading = guard.review(reading, datetime.now(UTC))
        updated = guard.state
        # Tarsius can accept a lower index after several agreeing observations.
        # A downward correction would spoil Home Assistant consumption statistics.
        if previous is not None and updated is not None and updated.value < previous.value:
            reading = reading.rejected(Rejection.DECREASED)
            updated = previous
        next_state = updated.as_dict() if updated is not None else None
        if next_state is not None and state is not None and METER_TOTAL_OFFSET in state:
            next_state[METER_TOTAL_OFFSET] = state[METER_TOTAL_OFFSET]
        return _result(reading, settings, updated.value if updated else None), next_state
    except tarsius.BackendError as err:
        raise ImageError("tarsius_unavailable") from err
    except tarsius.BlankFrameError:
        if calibrate:
            raise ImageError("meter_fault") from None
        return ModuleResult(
            {"meter_value": state["value"] if state else None, "unit": METER_UNITS[settings["kind"]]},
            "meter_fault",
        ), state
    except (OSError, tarsius.ImageError) as err:
        raise ImageError("invalid_image") from err
    except ValueError as err:
        raise ImageError("meter_invalid_settings") from err


def _result(reading, settings: dict, accepted: float | None = None) -> ModuleResult:
    return ModuleResult(
        {
            "value": reading.value,
            "candidate": reading.candidate,
            "meter_value": accepted,
            "confidence": round(reading.confidence, 4),
            "unit": METER_UNITS[settings["kind"]],
        },
        f"meter_{reading.rejection.value}" if reading.rejection else None,
    )


async def async_read_meter(
    hass: HomeAssistant, frame: ImageFrame, settings: dict, state: dict | None
) -> ModuleResult:
    """Return the observation and proposed persistent state."""
    await async_ensure_tarsius(hass)
    result, updated = await hass.async_add_executor_job(_read, frame, settings, state, False)
    return ModuleResult(result.data, result.reason, updated)


def calibrate_meter(frame: ImageFrame, settings: dict) -> tuple[ModuleResult, dict]:
    """Test a layout on the same image used to draw it."""
    result, calibration = _read(frame, settings, None, True)
    assert calibration is not None
    return result, calibration


def seed_state(value: float) -> dict:
    """Build an explicitly confirmed starting point."""
    return {"value": value, "at": datetime.now(UTC).isoformat()}



def _meter_total(state: Mapping[str, Any]) -> Decimal:
    return Decimal(str(state["value"])) + Decimal(state.get(METER_TOTAL_OFFSET, "0"))


def meter_entity_values(state: Mapping[str, Any]) -> dict[str, float]:
    """Keep the physical reading available alongside the consumption counter."""
    return {"meter_value": state["value"], "meter_total": float(_meter_total(state))}


def rebase_meter_state(previous: Mapping[str, Any], value: float) -> dict:
    """Start from a verified reading and keep the published total continuous."""
    return {
        **seed_state(value),
        METER_TOTAL_OFFSET: str(_meter_total(previous) - Decimal(str(value))),
    }
