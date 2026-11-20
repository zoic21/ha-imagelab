"""Image Lab integration for Home Assistant."""

from pathlib import Path
from typing import Any

import probatio
from aiohttp import web
from homeassistant.components import panel_custom, websocket_api
from homeassistant.components.http import (
    KEY_HASS,
    KEY_HASS_USER,
    HomeAssistantView,
    StaticPathConfig,
)
from homeassistant.config_entries import (
    SIGNAL_CONFIG_ENTRY_CHANGED,
    ConfigEntry,
    ConfigEntryChange,
    ConfigEntryState,
)
from homeassistant.const import CONF_ENTITY_ID
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    callback,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.service import async_register_admin_service
from homeassistant.helpers.typing import ConfigType

from .analysis import async_analyze, resolve_entity_id
from .const import (
    CONF_IMAGE_KEY,
    CONF_MODULE,
    CONF_PROFILE_ID,
    CONF_SOURCE_TYPE,
    DOMAIN,
    PANEL_PATH,
    SERVICE_ANALYZE,
)
from .images import get_image_storage

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the panel, its API and the action once per Home Assistant instance."""

    async def async_handle_analyze(call: ServiceCall) -> ServiceResponse:
        return (await async_analyze(hass, call.data[CONF_PROFILE_ID])).response

    async_register_admin_service(
        hass,
        DOMAIN,
        SERVICE_ANALYZE,
        async_handle_analyze,
        schema=probatio.Schema({probatio.Required(CONF_PROFILE_ID): cv.string}),
        supports_response=SupportsResponse.ONLY,
    )
    websocket_api.async_register_command(hass, async_subscribe_profiles)
    hass.http.register_view(ImageLabPreviewView)

    static_url = f"/{DOMAIN}_assets"
    assets = Path(__file__).parent / "panel"
    await hass.http.async_register_static_paths(
        [StaticPathConfig(static_url, str(assets), cache_headers=False)]
    )
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_PATH,
        webcomponent_name="image-lab-panel",
        sidebar_title="Image Lab",
        sidebar_icon="mdi:image-search",
        module_url=f"{static_url}/panel.js",
        require_admin=True,
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Make the profile available through Home Assistant's config entry registry."""
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the profile without removing its configuration or original."""
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Remove only the original owned by the deleted analysis."""
    await get_image_storage(hass).async_remove(entry.data[CONF_IMAGE_KEY])


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
                "title": entry.title,
                CONF_MODULE: entry.data[CONF_MODULE],
                CONF_SOURCE_TYPE: entry.data[CONF_SOURCE_TYPE],
                CONF_ENTITY_ID: resolve_entity_id(hass, entry.data.get(CONF_ENTITY_ID)),
                "available": entry.state is ConfigEntryState.LOADED
                and entry.disabled_by is None,
            }
            for entry in sorted(
                hass.config_entries.async_entries(DOMAIN),
                key=lambda item: item.title.casefold(),
            )
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


class ImageLabPreviewView(HomeAssistantView):
    """Serve the exact frame processed by the analysis, to an admin only."""

    url = f"/api/{DOMAIN}/preview/{{profile_id}}"
    name = f"api:{DOMAIN}:preview"

    async def get(self, request: web.Request, profile_id: str) -> web.Response:
        """Run a configured analysis and return its frame or failure reason."""
        if not request[KEY_HASS_USER].is_admin:
            raise web.HTTPForbidden
        result = await async_analyze(request.app[KEY_HASS], profile_id)
        headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
        if result.frame is None:
            return self.json(result.response, status_code=422, headers=headers)
        headers.update(
            {
                "X-Image-Lab-Width": str(result.frame.width),
                "X-Image-Lab-Height": str(result.frame.height),
            }
        )
        return web.Response(
            body=result.frame.content,
            content_type=result.frame.content_type,
            headers=headers,
        )
