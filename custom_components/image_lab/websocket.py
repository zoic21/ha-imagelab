"""Register Image Lab panel commands and publish live profile and capture updates."""

from typing import Any

import probatio
from homeassistant.components import websocket_api
from homeassistant.config_entries import (
    SIGNAL_CONFIG_ENTRY_CHANGED,
    ConfigEntry,
    ConfigEntryChange,
    ConfigEntryState,
)
from homeassistant.const import CONF_ENTITY_ID
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .analysis import resolve_entity_id
from .const import (
    CONF_IMAGE_REVISION,
    CONF_MODULE,
    CONF_PALETTE_SIZE,
    CONF_PROFILE_ID,
    CONF_SOURCE_TYPE,
    DEFAULT_PALETTE_SIZE,
    DOMAIN,
)
from .meter import METER_SEED
from .module_settings import async_module_settings
from .publication import async_set_publication, publication_settings
from .result_store import SIGNAL_CAPTURE_SAVED, observation_response


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    """Register the panel's admin commands during integration setup."""
    websocket_api.async_register_command(hass, async_subscribe_profiles)
    websocket_api.async_register_command(hass, async_subscribe_captures)
    websocket_api.async_register_command(hass, async_set_publication)
    websocket_api.async_register_command(hass, async_test_source)
    websocket_api.async_register_command(hass, async_module_settings)


@websocket_api.websocket_command(
    {probatio.Required("type"): f"{DOMAIN}/subscribe_profiles"}
)
@websocket_api.require_admin
@callback
def async_subscribe_profiles(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Send the initial list and keep the panel in sync with native config flows."""

    @callback
    def async_send_profiles() -> None:
        profiles = [
            {
                CONF_PROFILE_ID: entry.entry_id,
                CONF_IMAGE_REVISION: entry.data.get(CONF_IMAGE_REVISION),
                "region": entry.data.get("region"),
                "meter_initialized": METER_SEED in entry.data,
                "modified_at": entry.modified_at.isoformat(),
                "title": entry.title,
                "output_entity_id": (
                    er.async_get(hass).async_get_entity_id(
                        entry.runtime_data.platform,
                        DOMAIN,
                        entry.runtime_data.unique_id,
                    )
                    if entry.state is ConfigEntryState.LOADED
                    and entry.runtime_data and entry.runtime_data.platform
                    else None
                ),
                "interval_minutes": (
                    0 if entry.pref_disable_polling else entry.options.get("interval_minutes", 0)
                ),
                "publication": publication_settings(entry),
                CONF_MODULE: entry.data[CONF_MODULE],
                CONF_SOURCE_TYPE: entry.data[CONF_SOURCE_TYPE],
                CONF_PALETTE_SIZE: (
                    entry.data.get(CONF_PALETTE_SIZE, DEFAULT_PALETTE_SIZE)
                    if entry.data[CONF_MODULE] == "palette"
                    else None
                ),
                CONF_ENTITY_ID: resolve_entity_id(hass, entry.data.get(CONF_ENTITY_ID)),
                "available": entry.state is ConfigEntryState.LOADED
                and entry.disabled_by is None,
            }
            for entry in sorted(
                hass.config_entries.async_entries(DOMAIN),
                key=lambda item: item.title.casefold(),
            )
            if CONF_MODULE in entry.data
        ]
        connection.send_message(websocket_api.event_message(msg["id"], profiles))

    @callback
    def async_entry_changed(change: ConfigEntryChange, entry: ConfigEntry) -> None:
        if entry.domain == DOMAIN:
            async_send_profiles()

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_CONFIG_ENTRY_CHANGED, async_entry_changed
    )
    connection.send_result(msg["id"])
    async_send_profiles()


@websocket_api.websocket_command({probatio.Required("type"): f"{DOMAIN}/subscribe_captures"})
@websocket_api.require_admin
@callback
def async_subscribe_captures(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Notify the mobile list when a new image is available."""

    @callback
    def async_capture_saved(profile_id: str, image_id: str) -> None:
        connection.send_message(websocket_api.event_message(
            msg["id"], {CONF_PROFILE_ID: profile_id, "image_id": image_id}
        ))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_CAPTURE_SAVED, async_capture_saved
    )
    connection.send_result(msg["id"])
    # A reconnect can have missed captures. Existing lists revalidate visible thumbnails.
    connection.send_message(websocket_api.event_message(msg["id"], None))


@websocket_api.websocket_command({
    probatio.Required("type"): f"{DOMAIN}/test_source",
    probatio.Required(CONF_PROFILE_ID): cv.string,
})
@websocket_api.require_admin
@websocket_api.async_response
async def async_test_source(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Run an on-demand analysis and return the exact saved observation."""
    entry = hass.config_entries.async_get_entry(msg[CONF_PROFILE_ID])
    if entry is None or entry.domain != DOMAIN or CONF_MODULE not in entry.data:
        response = {"status": "error", "reason": "profile_not_found", "image_id": None}
    elif entry.state is not ConfigEntryState.LOADED or entry.runtime_data is None:
        response = {"status": "error", "reason": "profile_unavailable", "image_id": None}
    else:
        result, observation = await entry.runtime_data.async_run_manual()
        if observation is not None:
            response = observation_response(observation)
        elif result.frame is not None:
            response = {"status": "error", "reason": "storage_error", "image_id": None}
        else:
            response = {**result.response, "image_id": None}
    connection.send_result(msg["id"], response)
