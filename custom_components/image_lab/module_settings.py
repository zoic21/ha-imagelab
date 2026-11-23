"""Native form schemas for the palette and object detection settings."""

from collections.abc import Mapping
from typing import Any

import probatio
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv, selector

from .const import (
    CONF_MODULE,
    CONF_OBJECT_CONFIDENCE,
    CONF_OBJECT_DETAILED,
    CONF_OBJECT_LABELS,
    CONF_PALETTE_SIZE,
    CONF_PROFILE_ID,
    DEFAULT_OBJECT_CONFIDENCE,
    DEFAULT_PALETTE_SIZE,
    DOMAIN,
    MAX_OBJECT_CONFIDENCE,
    MAX_PALETTE_SIZE,
    MIN_OBJECT_CONFIDENCE,
    MIN_PALETTE_SIZE,
)
from .object_detection import LABELS

_INTEGER_ERRORS = {
    CONF_PALETTE_SIZE: "invalid_palette_size",
    CONF_OBJECT_CONFIDENCE: "invalid_object_confidence",
}


def module_settings_fields(
    module: str, data: Mapping[str, Any]
) -> dict[probatio.Required, selector.Selector[Any]]:
    """Build one schema for creation and for editing an existing analysis."""
    if module == "palette":
        return {
            probatio.Required(
                CONF_PALETTE_SIZE,
                default=data.get(CONF_PALETTE_SIZE, DEFAULT_PALETTE_SIZE),
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=MIN_PALETTE_SIZE,
                    max=MAX_PALETTE_SIZE,
                    step=1,
                    mode=selector.NumberSelectorMode.BOX,
                )
            )
        }
    if module == "object_detection":
        return {
            probatio.Required(
                CONF_OBJECT_LABELS, default=data.get(CONF_OBJECT_LABELS, [])
            ): selector.SelectSelector(
                selector.SelectSelectorConfig(
                    options=list(LABELS),
                    translation_key=CONF_OBJECT_LABELS,
                    multiple=True,
                    sort=True,
                )
            ),
            probatio.Required(
                CONF_OBJECT_CONFIDENCE,
                default=data.get(CONF_OBJECT_CONFIDENCE, DEFAULT_OBJECT_CONFIDENCE),
            ): selector.NumberSelector(
                selector.NumberSelectorConfig(
                    min=MIN_OBJECT_CONFIDENCE,
                    max=MAX_OBJECT_CONFIDENCE,
                    step=1,
                    unit_of_measurement="%",
                    mode=selector.NumberSelectorMode.BOX,
                )
            ),
            probatio.Required(
                CONF_OBJECT_DETAILED, default=data.get(CONF_OBJECT_DETAILED, False)
            ): selector.BooleanSelector(),
        }
    return {}


def normalize_module_settings(values: dict[str, Any]) -> dict[str, str]:
    """Normalize selector output and report field-specific errors."""
    errors = {}
    for field in values.keys() & _INTEGER_ERRORS.keys():
        value = values[field]
        if value % 1:
            errors[field] = _INTEGER_ERRORS[field]
        else:
            values[field] = int(value)
    if CONF_OBJECT_LABELS in values:
        values[CONF_OBJECT_LABELS] = list(dict.fromkeys(values[CONF_OBJECT_LABELS]))
    return errors


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/module_settings",
        probatio.Required(CONF_PROFILE_ID): cv.string,
        probatio.Optional("settings"): dict,
    }
)
@websocket_api.require_admin
@callback
def async_module_settings(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Read or update the current module settings without changing the source."""
    entry = hass.config_entries.async_get_entry(msg[CONF_PROFILE_ID])
    if entry is None or entry.domain != DOMAIN or CONF_MODULE not in entry.data:
        connection.send_error(msg["id"], "profile_not_found", "Analysis not found")
        return
    module = entry.data[CONF_MODULE]
    fields = module_settings_fields(module, entry.data)
    if not fields:
        connection.send_error(msg["id"], "invalid_format", "Analysis uses different settings")
        return
    errors = {}
    if "settings" in msg:
        try:
            values = probatio.Schema(fields)(msg["settings"])
        except probatio.Invalid as err:
            if not err.path or err.path[0] not in _INTEGER_ERRORS:
                connection.send_error(msg["id"], "invalid_format", "Invalid analysis settings")
                return
            errors = {err.path[0]: _INTEGER_ERRORS[err.path[0]]}
        else:
            errors = normalize_module_settings(values)
            if not errors:
                changed = hass.config_entries.async_update_entry(
                    entry, data={**entry.data, **values}
                )
                if changed and entry.disabled_by is None:
                    hass.config_entries.async_schedule_reload(entry.entry_id)
                fields = module_settings_fields(module, entry.data)
    connection.send_result(
        msg["id"],
        {
            "data_schema": probatio.to_field_list(
                probatio.Schema(fields), custom_serializer=cv.custom_serializer
            ),
            "errors": errors,
        },
    )
