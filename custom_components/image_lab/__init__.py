"""Image Lab integration for Home Assistant."""

from json import dumps
from pathlib import Path
from typing import Any, ClassVar

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
from homeassistant.loader import async_get_integration
from homeassistant.util.file import WriteError

from .analysis import async_analyze, resolve_entity_id
from .comparison_api import HISTORY_SETTINGS, REGION, ComparisonImageView, ComparisonView, drop_captures
from .comparison_store import async_remove_comparison, get_comparison_store
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
    SOURCE_RENAME,
    SourceType,
)
from .images import ImageError, ImageFrame, async_get_frame, get_image_storage
from .meter import METER, METER_SEED
from .meter_api import MeterView
from .module_settings import async_module_settings
from .output import OUTPUTS, CameraSchedule, OutputCoordinator
from .result_store import Observation, async_remove_results, get_result_store

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the panel, its API and the action once per Home Assistant instance."""

    async def async_handle_analyze(call: ServiceCall) -> ServiceResponse:
        profile_id = call.data[CONF_PROFILE_ID]
        entry = hass.config_entries.async_get_entry(profile_id)
        if entry and entry.domain == DOMAIN and entry.state is ConfigEntryState.LOADED:
            coordinator = entry.runtime_data
            if coordinator is not None:
                result, _ = await coordinator.async_run_manual()
                return result.response
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
    websocket_api.async_register_command(hass, async_module_settings)
    hass.http.register_view(AnalysisFlowView(hass.config_entries.flow))
    hass.http.register_view(ImageLabPreviewView)
    hass.http.register_view(CameraZoneView)
    hass.http.register_view(MeterView)
    hass.http.register_view(ComparisonView)
    hass.http.register_view(ComparisonImageView)

    # A versioned directory also invalidates the panel's relative module imports.
    integration = await async_get_integration(hass, DOMAIN)
    static_url = f"/{DOMAIN}_assets/{integration.version}"
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
    coordinator = OutputCoordinator(hass, entry, kind)
    entry.runtime_data = coordinator
    registry = er.async_get(hass)
    for entity in er.async_entries_for_config_entry(registry, entry.entry_id):
        if entity.platform == DOMAIN and (not kind or entity.unique_id != coordinator.unique_id):
            registry.async_remove(entity.entity_id)
    if coordinator.platform:
        await hass.config_entries.async_forward_entry_setups(entry, [coordinator.platform])
    if kind or minutes:

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
    if entry.data[CONF_MODULE] == "comparison":
        await async_remove_comparison(hass, entry.entry_id)
    else:
        await async_remove_results(hass, entry.entry_id)


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
    """Start an analysis creation or rename flow from Image Lab."""

    url = f"/api/{DOMAIN}/analysis_flow"
    name = f"api:{DOMAIN}:analysis_flow"

    def get_context(self, data: dict[str, Any]) -> dict[str, Any]:
        if data["handler"] != DOMAIN:
            raise web.HTTPBadRequest
        context = super().get_context(data)
        source = SOURCE_RENAME if "entry_id" in context else SOURCE_ANALYSIS
        return {**context, "source": source}


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
    extra_urls: ClassVar[list[str]] = [f"{url}/{{item}}"]
    name = f"api:{DOMAIN}:preview"
    headers: ClassVar[dict[str, str]] = {
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    }

    def _entry(self, request: web.Request, profile_id: str) -> ConfigEntry:
        if not request[KEY_HASS_USER].is_admin:
            raise web.HTTPForbidden
        entry = request.app[KEY_HASS].config_entries.async_get_entry(profile_id)
        if entry is None or entry.domain != DOMAIN or CONF_MODULE not in entry.data:
            raise web.HTTPNotFound
        return entry

    async def get(
        self, request: web.Request, profile_id: str, item: str | None = None
    ) -> web.Response:
        """Read the last result or a retained capture."""
        entry = self._entry(request, profile_id)
        hass = request.app[KEY_HASS]
        if entry.data[CONF_MODULE] == "comparison":
            if item is not None:
                raise web.HTTPNotFound
            store = get_comparison_store(hass, profile_id)
        else:
            store = get_result_store(hass, profile_id)
        try:
            if item == "history":
                return self.json(await store.async_history(), headers=self.headers)
            if item == "history_settings":
                return self.json(await store.async_history_settings(), headers=self.headers)
            thumbnail = item is not None and request.query.get("thumbnail") == "1"
            if item is None and (etag := request.headers.get("If-None-Match")):
                latest = await store.async_latest()
                if latest and etag == f'"{latest["id"]}"':
                    return web.Response(status=304, headers={**self.headers, "ETag": etag})
            saved = await store.async_read(item, thumbnail)
        except OSError:
            return self.json({"reason": "storage_error"}, status_code=422, headers=self.headers)
        except ImageError as err:
            return self.json({"reason": err.reason}, status_code=422, headers=self.headers)
        if saved is None:
            if item is not None:
                raise web.HTTPNotFound
            return web.Response(status=204, headers=self.headers)
        observation, frame = saved
        if thumbnail:
            return web.Response(body=frame.content, content_type=frame.content_type, headers=self.headers)
        return self._image_response(observation, frame)

    async def post(
        self, request: web.Request, profile_id: str, item: str | None = None
    ) -> web.Response:
        """Record a manual analysis and publish its result entity."""
        entry = self._entry(request, profile_id)
        if item == "history_settings" and entry.data[CONF_MODULE] != "comparison":
            try:
                settings = HISTORY_SETTINGS(await request.json())
                if settings["mode"] == "changes":
                    raise probatio.Invalid("Change detection is only available for comparisons")
            except (ValueError, probatio.Invalid):
                raise web.HTTPBadRequest from None
            store = get_result_store(request.app[KEY_HASS], profile_id)
            try:
                await store.async_set_history_settings(settings)
            except (ImageError, OSError, WriteError):
                return self.json({"reason": "storage_error"}, status_code=422, headers=self.headers)
            return self.json(settings, headers=self.headers)
        if item is not None:
            raise web.HTTPNotFound
        if entry.state is not ConfigEntryState.LOADED or entry.runtime_data is None:
            return self.json({"reason": "profile_unavailable"}, status_code=422, headers=self.headers)
        result, observation = await entry.runtime_data.async_run_manual()
        if result.frame is None or observation is None:
            reason = "storage_error" if result.frame is not None else result.response["reason"]
            return self.json({"reason": reason}, status_code=422, headers=self.headers)
        return self._image_response(observation, result.frame)

    def _image_response(self, observation: Observation, frame: ImageFrame) -> web.Response:
        result = observation["response"]
        headers = self.headers.copy()
        headers.update(
            {
                "ETag": f'"{observation["id"]}"',
                "X-Image-Lab-Width": str(frame.width),
                "X-Image-Lab-Height": str(frame.height),
                "X-Image-Lab-Time": observation["time"],
                "X-Image-Lab-Manual": "1" if observation["manual"] else "0",
            }
        )
        if result.get("confirmation") == "disagreed":
            headers["X-Image-Lab-Confirmation"] = "disagreed"
        if result.get(CONF_MODULE) == METER:
            headers["X-Image-Lab-Meter"] = dumps(
                {**result["data"], "reason": result.get("reason")}, separators=(",", ":")
            )
        elif result.get(CONF_MODULE) == "palette":
            # Send the small palette alongside the exact image used for the analysis.
            headers["X-Image-Lab-Palette-Rgb"] = dumps(
                result["data"]["palette_rgb"], separators=(",", ":")
            )
        elif result.get(CONF_MODULE) == "object_detection":
            # Compact rows keep the preview header below HTTP field-size limits.
            data = result["data"]
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
            body=frame.content,
            content_type=frame.content_type,
            headers=headers,
        )


class CameraZoneView(HomeAssistantView):
    """Edit a comparison, palette or detection region on the full source image."""

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
            or entry.data.get(CONF_MODULE) not in ("comparison", "palette", "object_detection")
            or (entry.data[CONF_MODULE] != "comparison" and entry.data[CONF_SOURCE_TYPE] != SourceType.CAMERA)
        ):
            raise web.HTTPNotFound
        return entry

    async def get(self, request: web.Request, profile_id: str) -> web.Response:
        entry = self._entry(request, profile_id)
        hass = request.app[KEY_HASS]
        try:
            frame = await async_get_frame(
                hass,
                SourceType(entry.data[CONF_SOURCE_TYPE]),
                resolve_entity_id(hass, entry.data.get(CONF_ENTITY_ID)),
                entry.data[CONF_IMAGE_KEY],
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
        if entry.data[CONF_MODULE] == "comparison":
            try:
                await get_comparison_store(hass, profile_id).async_mutate("settings", {"region": region})
            except (ImageError, OSError, WriteError):
                return self.json({"reason": "storage_error"}, status_code=422)
        else:
            hass.config_entries.async_update_entry(entry, data={**entry.data, "region": region})
        return self.json({"region": region})
