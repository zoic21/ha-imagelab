"""Image Lab integration for Home Assistant."""

from pathlib import Path
from typing import Any, ClassVar

import probatio
from aiohttp import web
from homeassistant.components import panel_custom
from homeassistant.components.config.config_entries import ConfigManagerFlowIndexView
from homeassistant.components.http import KEY_HASS, HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
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
    CONF_MODULE,
    CONF_PROFILE_ID,
    CONF_SOURCE_TYPE,
    DOMAIN,
    PANEL_FLOW,
    PANEL_PATH,
    SERVICE_ANALYZE,
    SourceType,
)
from .http import RESPONSE_HEADERS, admin_profile
from .images import ImageError, async_get_frame, get_image_storage
from .meter import METER
from .meter_api import MeterView
from .meter_output import MeterCoordinator
from .output import OUTPUTS, CameraSchedule, ConfirmingOutputCoordinator
from .result_store import async_remove_results, get_result_store, observation_response
from .websocket import async_register_commands

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
    async_register_commands(hass)
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
    coordinator_class = MeterCoordinator if entry.data[CONF_MODULE] == METER else ConfirmingOutputCoordinator
    coordinator = coordinator_class(hass, entry, kind)
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


class AnalysisFlowView(ConfigManagerFlowIndexView):
    """Start an analysis creation or rename flow from Image Lab."""

    url = f"/api/{DOMAIN}/analysis_flow"
    name = f"api:{DOMAIN}:analysis_flow"

    def get_context(self, data: dict[str, Any]) -> dict[str, Any]:
        if data["handler"] != DOMAIN:
            raise web.HTTPBadRequest
        context = super().get_context(data)
        # Keep HA's user/reconfigure source so unfinished forms stay out of discovery.
        return {**context, PANEL_FLOW: True}


class ImageLabPreviewView(HomeAssistantView):
    """Serve the exact frame processed by the analysis, to an admin only."""

    url = f"/api/{DOMAIN}/preview/{{profile_id}}"
    extra_urls: ClassVar[list[str]] = [f"{url}/{{item}}"]
    name = f"api:{DOMAIN}:preview"

    async def get(
        self, request: web.Request, profile_id: str, item: str | None = None
    ) -> web.Response:
        """Read the last result or a retained capture."""
        entry = admin_profile(request, profile_id)
        hass = request.app[KEY_HASS]
        if entry.data[CONF_MODULE] == "comparison":
            if item is not None:
                raise web.HTTPNotFound
            store = get_comparison_store(hass, profile_id)
        else:
            store = get_result_store(hass, profile_id)
        try:
            if item == "history":
                return self.json(await store.async_history(), headers=RESPONSE_HEADERS)
            if item == "history_settings":
                return self.json(await store.async_history_settings(), headers=RESPONSE_HEADERS)
            if request.query.get("metadata") == "1":
                if item is None:
                    raise web.HTTPNotFound
                observation = await store.async_observation(item)
                if observation is None:
                    raise web.HTTPNotFound
                return self.json(observation_response(observation), headers=RESPONSE_HEADERS)
            thumbnail = request.query.get("thumbnail") == "1"
            if item is None and (etag := request.headers.get("If-None-Match")):
                latest = await store.async_latest()
                if latest and etag == f'"{latest["id"]}"':
                    return web.Response(status=304, headers={**RESPONSE_HEADERS, "ETag": etag})
            saved = await store.async_read(item, thumbnail)
        except OSError:
            return self.json({"reason": "storage_error"}, status_code=422, headers=RESPONSE_HEADERS)
        except ImageError as err:
            return self.json({"reason": err.reason}, status_code=422, headers=RESPONSE_HEADERS)
        if saved is None:
            if item is not None:
                raise web.HTTPNotFound
            return web.Response(status=204, headers=RESPONSE_HEADERS)
        observation, frame = saved
        return web.Response(
            body=frame.content, content_type=frame.content_type,
            headers=RESPONSE_HEADERS if thumbnail else {**RESPONSE_HEADERS, "ETag": f'"{observation["id"]}"'},
        )

    async def post(
        self, request: web.Request, profile_id: str, item: str | None = None
    ) -> web.Response:
        """Save history settings for a non-comparison profile."""
        entry = admin_profile(request, profile_id)
        if item is None:
            raise web.HTTPMethodNotAllowed("POST", ["GET"])
        if item != "history_settings" or entry.data[CONF_MODULE] == "comparison":
            raise web.HTTPNotFound
        try:
            settings = HISTORY_SETTINGS(await request.json())
        except (ValueError, probatio.Invalid):
            raise web.HTTPBadRequest from None
        if settings["mode"] == "changes":
            raise web.HTTPBadRequest
        store = get_result_store(request.app[KEY_HASS], profile_id)
        try:
            await store.async_set_history_settings(settings)
        except (ImageError, OSError, WriteError):
            return self.json({"reason": "storage_error"}, status_code=422, headers=RESPONSE_HEADERS)
        return self.json(settings, headers=RESPONSE_HEADERS)


class CameraZoneView(HomeAssistantView):
    """Edit a comparison, palette or detection region on the full source image."""

    url = f"/api/{DOMAIN}/zone/{{profile_id}}"
    name = f"api:{DOMAIN}:zone"

    @staticmethod
    def _entry(request: web.Request, profile_id: str) -> ConfigEntry:
        entry = admin_profile(request, profile_id)
        if (
            entry.data[CONF_MODULE] not in ("comparison", "palette", "object_detection")
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
