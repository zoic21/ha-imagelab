"""Expose and update the result entity and camera schedule together."""

from typing import Any

import probatio
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv

from .comparison_store import get_comparison_store
from .const import CONF_MODULE, CONF_PROFILE_ID, CONF_SOURCE_TYPE, DOMAIN, MAX_INTERVAL_MINUTES, SourceType
from .images import ImageError
from .meter import METER
from .output import BINARY_CLASSES, OUTPUTS

_MAPPING = ("binary_class", "on_state", "off_state")


def _integer_at_most(maximum: int):
    def validate(value: int) -> int:
        if type(value) is not int or not 0 <= value <= maximum:
            raise probatio.Invalid("Expected an integer in range")
        return value

    return validate


_SETTINGS = probatio.Schema({
    probatio.Optional("output"): cv.string,
    probatio.Optional("interval_minutes"): _integer_at_most(MAX_INTERVAL_MINUTES),
    probatio.Optional("confirmation_seconds"): _integer_at_most(60),
    probatio.Optional("binary_class"): probatio.In(BINARY_CLASSES),
    probatio.Optional("on_state"): cv.string,
    probatio.Optional("off_state"): cv.string,
})


def publication_settings(entry: ConfigEntry) -> dict[str, Any]:
    """Read the effective settings without rewriting existing options."""
    kinds = OUTPUTS[entry.data[CONF_MODULE]]
    kind = entry.options.get("output")
    camera = entry.data[CONF_SOURCE_TYPE] == SourceType.CAMERA
    confirmation = camera and kind in kinds and entry.data[CONF_MODULE] != METER
    interval = camera and not entry.pref_disable_polling
    return {
        "output_types": ("none", *kinds),
        "binary_classes": BINARY_CLASSES if "binary" in kinds else (),
        "settings": {
            "output": kind if kind in kinds else "none",
            "interval_minutes": entry.options.get("interval_minutes", 0) if interval else 0,
            "confirmation_seconds": entry.options.get("confirmation_seconds", 0) if confirmation else 0,
            "binary_class": entry.options.get("binary_class", "opening"),
            "on_state": entry.options.get("on_state", ""),
            "off_state": entry.options.get("off_state", ""),
        },
    }


def _update_options(hass: HomeAssistant, entry: ConfigEntry, changes: dict, state_ids: set[str]) -> bool:
    module = entry.data[CONF_MODULE]
    camera = entry.data[CONF_SOURCE_TYPE] == SourceType.CAMERA
    options = {**entry.options, **changes}
    kind = options.get("output", "none")
    if "output" in changes and kind not in ("none", *OUTPUTS[module]):
        raise ValueError("invalid_publication")
    if "interval_minutes" in changes and not camera:
        raise ValueError("invalid_publication")
    if "confirmation_seconds" in changes and (not camera or module == METER):
        raise ValueError("invalid_publication")

    if kind == "binary" and ("output" in changes or changes.keys() & _MAPPING):
        on_state, off_state = options.get("on_state"), options.get("off_state")
        if len(state_ids) < 2:
            raise ValueError("need_two_states")
        if on_state not in state_ids or off_state not in state_ids:
            raise ValueError("state_removed")
        if on_state == off_state:
            raise ValueError("different_states")
        options.setdefault("binary_class", "opening")
    elif changes.keys() & _MAPPING:
        raise ValueError("invalid_publication")

    if "output" in changes and kind != "binary":
        for key in _MAPPING:
            options.pop(key, None)
    if kind == "none":
        options.pop("output", None)
        if "confirmation_seconds" in options:
            options["confirmation_seconds"] = 0

    return hass.config_entries.async_update_entry(
        entry, options=options,
        pref_disable_polling=False if changes.get("interval_minutes") else entry.pref_disable_polling,
    )


@websocket_api.websocket_command({
    probatio.Required("type"): f"{DOMAIN}/set_publication",
    probatio.Required(CONF_PROFILE_ID): cv.string,
    probatio.Required("settings"): _SETTINGS,
})
@websocket_api.require_admin
@websocket_api.async_response
async def async_set_publication(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Save changed publication fields in one update and reload at most once."""
    profile_id = msg[CONF_PROFILE_ID]
    entry = hass.config_entries.async_get_entry(profile_id)
    if entry is None or entry.domain != DOMAIN or CONF_MODULE not in entry.data:
        connection.send_error(msg["id"], "profile_not_found", "Analysis not found")
        return
    changes = msg["settings"]
    try:
        if entry.data[CONF_MODULE] == "comparison" and (
            changes.get("output") == "binary" or changes.keys() & _MAPPING
        ):
            store = get_comparison_store(hass, profile_id)
            async with store.lock:
                gallery = await hass.async_add_executor_job(store.load)
                if hass.config_entries.async_get_entry(profile_id) is not entry:
                    raise ValueError("profile_not_found")
                changed = _update_options(hass, entry, changes, {state["id"] for state in gallery["states"]})
        else:
            changed = _update_options(hass, entry, changes, set())
    except (ImageError, OSError):
        connection.send_error(msg["id"], "gallery_unavailable", "Could not read the comparison gallery")
        return
    except ValueError as err:
        connection.send_error(msg["id"], str(err), "Invalid publication settings")
        return
    if changed and entry.disabled_by is None and not await hass.config_entries.async_reload(profile_id):
        connection.send_error(msg["id"], "profile_unavailable", "Could not reload analysis")
        return
    connection.send_result(msg["id"], publication_settings(entry))
