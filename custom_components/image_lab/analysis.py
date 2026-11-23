"""Run a configured Image Lab module on its selected source."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import CONF_ENTITY_ID
from homeassistant.core import HomeAssistant, ServiceResponse
from homeassistant.helpers import entity_registry as er

from .comparison import Settings
from .comparison_store import get_comparison_store
from .const import (
    CONF_IMAGE_KEY,
    CONF_MODULE,
    CONF_OBJECT_CONFIDENCE,
    CONF_OBJECT_DETAILED,
    CONF_OBJECT_LABELS,
    CONF_PALETTE_SIZE,
    CONF_PROFILE_ID,
    CONF_SOURCE_TYPE,
    DEFAULT_OBJECT_CONFIDENCE,
    DEFAULT_PALETTE_SIZE,
    DOMAIN,
    SourceType,
)
from .images import ImageError, ImageFrame, async_get_frame, crop_frame
from .meter import METER, METER_SEED, METER_SETTINGS, async_read_meter, meter_source
from .models import ModuleResult
from .object_detection import ObjectDetector
from .palette import extract_palette
from .result_store import get_result_store


async def _async_palette(
    hass: HomeAssistant,
    entry: ConfigEntry,
    frame: ImageFrame | None,
    settings: Settings | None,
) -> tuple[ModuleResult, ImageFrame]:
    assert frame is not None
    size = entry.data.get(CONF_PALETTE_SIZE, DEFAULT_PALETTE_SIZE)
    return ModuleResult(
        await hass.async_add_executor_job(extract_palette, frame, size)
    ), frame


async def _async_compare(
    hass: HomeAssistant,
    entry: ConfigEntry,
    frame: ImageFrame | None,
    settings: Settings | None,
) -> tuple[ModuleResult, ImageFrame]:
    return await get_comparison_store(hass, entry.entry_id).async_run(
        frame, settings
    )


async def _async_detect_objects(
    hass: HomeAssistant,
    entry: ConfigEntry,
    frame: ImageFrame | None,
    settings: Settings | None,
) -> tuple[ModuleResult, ImageFrame]:
    assert frame is not None
    key = f"{DOMAIN}.object_detector"
    if key not in hass.data:
        hass.data[key] = ObjectDetector()
    return await hass.data[key].async_detect(
        hass,
        frame,
        entry.data.get(CONF_OBJECT_LABELS, []),
        entry.data.get(CONF_OBJECT_CONFIDENCE, DEFAULT_OBJECT_CONFIDENCE),
        entry.data.get(CONF_OBJECT_DETAILED, False),
    )


async def _async_meter(
    hass: HomeAssistant,
    entry: ConfigEntry,
    frame: ImageFrame | None,
    settings: Settings | None,
) -> tuple[ModuleResult, ImageFrame]:
    assert frame is not None
    config = entry.data.get(METER_SETTINGS)
    if config is None or config["source"] != meter_source(entry.data):
        return ModuleResult({}, "meter_needs_calibration"), frame
    store = get_result_store(hass, entry.entry_id)
    state = await store.async_meter_state() or entry.data.get(METER_SEED)
    return await async_read_meter(hass, frame, config, state), frame


@dataclass(frozen=True)
class AnalysisModule:
    """Sources and image processor for a configured module."""

    sources: tuple[SourceType, ...]
    process: Callable[
        [HomeAssistant, ConfigEntry, ImageFrame | None, Settings | None],
        Awaitable[tuple[ModuleResult, ImageFrame]],
    ]


MODULES = {
    "comparison": AnalysisModule(
        (SourceType.CAMERA, SourceType.UPLOAD), _async_compare
    ),
    "palette": AnalysisModule(tuple(SourceType), _async_palette),
    METER: AnalysisModule((SourceType.CAMERA, SourceType.UPLOAD), _async_meter),
    "object_detection": AnalysisModule(
        (SourceType.CAMERA, SourceType.UPLOAD), _async_detect_objects
    ),
}


@dataclass(frozen=True)
class AnalysisResult:
    """Common result and the optional frame for the authenticated panel."""

    response: ServiceResponse
    frame: ImageFrame | None = None
    meter_state: dict | None = None


def resolve_entity_id(hass: HomeAssistant, value: str | None) -> str | None:
    """Resolve a registry ID, keeping a configured source valid after a rename."""
    return er.async_resolve_entity_id(er.async_get(hass), value) if value else None


async def async_analyze(
    hass: HomeAssistant,
    profile_id: str,
    *,
    settings_override: Settings | None = None,
    scheduled_capture: Awaitable[ImageFrame] | None = None,
) -> AnalysisResult:
    """Load a profile, acquire its source and run its module outside the event loop."""
    response: ServiceResponse = {
        CONF_PROFILE_ID: profile_id,
        "status": "error",
        "data": {},
    }
    entry = hass.config_entries.async_get_entry(profile_id)
    if entry is None or entry.domain != DOMAIN or CONF_MODULE not in entry.data:
        return AnalysisResult({**response, "reason": "profile_not_found"})

    settings = entry.data
    source = SourceType(settings[CONF_SOURCE_TYPE])
    module_id = settings[CONF_MODULE]
    response.update({CONF_MODULE: module_id, CONF_SOURCE_TYPE: source})
    if entry.state is not ConfigEntryState.LOADED or entry.disabled_by is not None:
        return AnalysisResult({**response, "reason": "profile_unavailable"})

    if module_id != "comparison" and settings_override is not None:
        return AnalysisResult({**response, "reason": "profile_unavailable"})

    try:
        frame = None
        if scheduled_capture is not None:
            frame = await scheduled_capture
            if (
                entry.state is not ConfigEntryState.LOADED
                or entry.data is not settings
                or hass.config_entries.async_get_entry(profile_id) is not entry
            ):
                return AnalysisResult({**response, "reason": "profile_unavailable"})
        else:
            frame = await async_get_frame(
                hass,
                source,
                resolve_entity_id(hass, settings.get(CONF_ENTITY_ID)),
                settings[CONF_IMAGE_KEY],
            )
        if module_id != "comparison" and (region := settings.get("region")):
            frame = await hass.async_add_executor_job(crop_frame, frame, region)
        result, frame = await MODULES[module_id].process(
            hass, entry, frame, settings_override
        )
    except ImageError as err:
        return AnalysisResult({**response, "reason": err.reason})
    except OSError:
        return AnalysisResult({**response, "reason": "storage_error"})

    if (
        entry.state is not ConfigEntryState.LOADED
        or entry.data is not settings
        or hass.config_entries.async_get_entry(profile_id) is not entry
    ):
        return AnalysisResult({**response, "reason": "profile_unavailable"})

    response.update(status="unknown" if result.reason else "ok", data=result.data)
    if result.reason:
        response["reason"] = result.reason
    return AnalysisResult(response, frame, result.meter_state)
