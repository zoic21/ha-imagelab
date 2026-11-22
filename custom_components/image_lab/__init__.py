"""Image Lab integration for Home Assistant."""

from json import dumps
from pathlib import Path
from typing import Any

import probatio
from aiohttp import web
from homeassistant.components import panel_custom, websocket_api
from homeassistant.components.config.config_entries import ConfigManagerFlowIndexView
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
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.service import async_register_admin_service
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.typing import ConfigType

from .analysis import async_analyze, resolve_entity_id
from .comparison_api import REGION, ComparisonImageView, ComparisonView, drop_captures
from .comparison_store import async_remove_comparison
from .const import (
    CONF_IMAGE_KEY,
    CONF_IMAGE_REVISION,
    CONF_MODULE,
    CONF_PALETTE_SIZE,
    CONF_PROFILE_ID,
    CONF_SOURCE_TYPE,
    DEFAULT_PALETTE_SIZE,
    DOMAIN,
    MAX_INTERVAL_MINUTES,
    PANEL_PATH,
    SERVICE_ANALYZE,
    SOURCE_ANALYSIS,
    SourceType,
)
from .images import ImageError, async_get_frame, get_image_storage
from .output import OUTPUTS, CameraSchedule, OutputCoordinator

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the panel, its API and the action once per Home Assistant instance."""

    async def async_handle_analyze(call: ServiceCall) -> ServiceResponse:
        profile_id = call.data[CONF_PROFILE_ID]
        entry = hass.config_entries.async_get_entry(profile_id)
        if entry and entry.domain == DOMAIN and entry.state is ConfigEntryState.LOADED:
            coordinator = entry.runtime_data
            if coordinator is not None:
                await coordinator.async_refresh()
                if coordinator.last_update_success and coordinator.data is not None:
                    return coordinator.data
                return {
                    CONF_PROFILE_ID: profile_id,
                    "status": "error",
                    "data": {},
                    "reason": "analysis_failed",
                }
        return (await async_analyze(hass, profile_id)).response

    async_register_admin_service(
        hass,
        DOMAIN,
        SERVICE_ANALYZE,
        async_handle_analyze,
        schema=probatio.Schema({probatio.Required(CONF_PROFILE_ID): cv.string}),
        supports_response=SupportsResponse.ONLY,
    )
    websocket_api.async_register_command(hass, async_subscribe_profiles)
    websocket_api.async_register_command(hass, async_set_schedule)
    hass.http.register_view(AnalysisFlowView(hass.config_entries.flow))
    hass.http.register_view(ImageLabPreviewView)
    hass.http.register_view(CameraZoneView)
    hass.http.register_view(ComparisonView)
    hass.http.register_view(ComparisonImageView)

    static_url = f"/{DOMAIN}_assets"
    assets = Path(__file__).parent / "panel"
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(static_url, str(assets), cache_headers=False),
            StaticPathConfig(
                f"/{DOMAIN}_icon.png",
                str(assets.parent / "brand" / "icon.png"),
                cache_headers=False,
            ),
        ]
    )
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_PATH,
        webcomponent_name="image-lab-panel",
        sidebar_title="Image Lab",
        sidebar_icon="mdi:image-search",
        module_url=f"{static_url}/panel.js",
        require_admin=True,
        handle_safe_area=True,
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the optional output and remove registry entries for retired output types."""
    if CONF_MODULE not in entry.data:
        entry.runtime_data = None
        return True
    kind = entry.options.get("output")
    if kind not in OUTPUTS[entry.data[CONF_MODULE]]:
        kind = None
    camera = entry.data[CONF_SOURCE_TYPE] == SourceType.CAMERA
    minutes = (
        entry.options.get("interval_minutes", 0)
        if camera and not entry.pref_disable_polling
        else 0
    )
    coordinator = OutputCoordinator(hass, entry, kind) if kind or minutes else None
    entry.runtime_data = coordinator
    registry = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.platform == DOMAIN and (
            not kind or coordinator is None or entity.unique_id != coordinator.unique_id
        ):
            registry.async_remove(entity.entity_id)
    if coordinator:
        if coordinator.platform:
            await hass.config_entries.async_forward_entry_setups(
                entry, [coordinator.platform]
            )

        @callback
        def start(hass: HomeAssistant) -> None:
            if entry.state is not ConfigEntryState.LOADED:
                return
            if minutes:
                key = f"{DOMAIN}.camera_schedule"
                if key not in hass.data:
                    hass.data[key] = CameraSchedule(hass)
                entry.async_on_unload(hass.data[key].subscribe(coordinator, minutes))
            if entry.data[CONF_SOURCE_TYPE] == SourceType.MEDIA_PLAYER:
                coordinator.async_watch_artwork()
            entry.async_create_background_task(
                hass, coordinator.async_initialize(), f"{coordinator.name} initial analysis",
                eager_start=False,
            )

        @callback
        def entry_loaded() -> None:
            if entry.state is ConfigEntryState.LOADED:
                entry.async_on_unload(async_at_started(hass, start))

        entry.async_on_unload(entry.async_on_state_change(entry_loaded))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Stop the profile's entity and polling."""
    if (coordinator := entry.runtime_data) and coordinator.platform:
        return await hass.config_entries.async_unload_platforms(
            entry, [coordinator.platform]
        )
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Remove only the original owned by the deleted analysis."""
    if CONF_MODULE not in entry.data:
        return
    await get_image_storage(hass).async_remove(entry.data[CONF_IMAGE_KEY])
    drop_captures(hass, entry.entry_id)
    await async_remove_comparison(hass, entry.entry_id)


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


class AnalysisFlowView(ConfigManagerFlowIndexView):
    """Start an analysis wizard only from Image Lab."""

    url = f"/api/{DOMAIN}/analysis_flow"
    name = f"api:{DOMAIN}:analysis_flow"

    def get_context(self, data: dict[str, Any]) -> dict[str, Any]:
        if data["handler"] != DOMAIN or "entry_id" in data:
            raise web.HTTPBadRequest
        return {**super().get_context(data), "source": SOURCE_ANALYSIS}


@websocket_api.websocket_command(
    {
        probatio.Required("type"): f"{DOMAIN}/set_schedule",
        probatio.Required(CONF_PROFILE_ID): cv.string,
        probatio.Required("interval_minutes"): probatio.All(
            int, probatio.Range(min=0, max=MAX_INTERVAL_MINUTES)
        ),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def async_set_schedule(
    hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]
) -> None:
    """Save the camera interval independently of result publication."""
    entry = hass.config_entries.async_get_entry(msg[CONF_PROFILE_ID])
    if (
        not entry
        or entry.domain != DOMAIN
        or entry.data.get(CONF_SOURCE_TYPE) != SourceType.CAMERA
    ):
        connection.send_error(msg["id"], "profile_not_found", "Camera analysis not found")
        return
    minutes = msg["interval_minutes"]
    changed = hass.config_entries.async_update_entry(
        entry, options={**entry.options, "interval_minutes": minutes},
        pref_disable_polling=False if minutes else entry.pref_disable_polling,
    )
    if changed and not await hass.config_entries.async_reload(entry.entry_id):
        connection.send_error(msg["id"], "profile_unavailable", "Could not reload analysis")
        return
    connection.send_result(msg["id"])


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
        if result.response[CONF_MODULE] == "palette":
            # Send the small palette alongside the exact image used for the analysis.
            headers["X-Image-Lab-Palette-Rgb"] = dumps(
                result.response["data"]["palette_rgb"], separators=(",", ":")
            )
        elif result.response[CONF_MODULE] == "object_detection":
            # Compact rows keep the preview header below HTTP field-size limits.
            data = result.response["data"]
            headers["X-Image-Lab-Objects"] = dumps(
                [
                    [
                        item["label"],
                        item["confidence"],
                        *(
                            item["box"][key]
                            for key in ("x_min", "y_min", "x_max", "y_max")
                        ),
                    ]
                    for item in data["objects"]
                ],
                separators=(",", ":"),
            )
            headers["X-Image-Lab-Objects-Truncated"] = "1" if data["truncated"] else "0"
        return web.Response(
            body=result.frame.content,
            content_type=result.frame.content_type,
            headers=headers,
        )


class CameraZoneView(HomeAssistantView):
    """Edit the region of a palette or detection profile on the full camera frame."""

    url = f"/api/{DOMAIN}/zone/{{profile_id}}"
    name = f"api:{DOMAIN}:zone"

    @staticmethod
    def _entry(request: web.Request, profile_id: str) -> ConfigEntry:
        if not request[KEY_HASS_USER].is_admin:
            raise web.HTTPForbidden
        entry = request.app[KEY_HASS].config_entries.async_get_entry(profile_id)
        if (
            entry is None
            or entry.domain != DOMAIN
            or entry.data.get(CONF_SOURCE_TYPE) != "camera"
            or entry.data[CONF_MODULE] == "comparison"
        ):
            raise web.HTTPNotFound
        return entry

    async def get(self, request: web.Request, profile_id: str) -> web.Response:
        entry = self._entry(request, profile_id)
        hass = request.app[KEY_HASS]
        try:
            frame = await async_get_frame(
                hass,
                SourceType.CAMERA,
                resolve_entity_id(hass, entry.data[CONF_ENTITY_ID]),
                "",
            )
        except ImageError as err:
            return self.json({"reason": err.reason}, status_code=422)
        return web.Response(
            body=frame.content,
            content_type=frame.content_type,
            headers={"Cache-Control": "no-store"},
        )

    async def post(self, request: web.Request, profile_id: str) -> web.Response:
        self._entry(request, profile_id)
        try:
            values = await request.json()
            entry = self._entry(request, profile_id)
            region = probatio.Schema(
                {probatio.Required("region"): probatio.Any(None, REGION)}
            )(values)["region"]
        except (probatio.Invalid, ValueError):
            return self.json({"reason": "invalid_request"}, status_code=400)
        hass = request.app[KEY_HASS]
        hass.config_entries.async_update_entry(
            entry, data={**entry.data, "region": region}
        )
        return self.json({"region": region})
