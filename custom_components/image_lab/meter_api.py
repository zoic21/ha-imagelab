"""Configure and test a meter layout without publishing a reading."""

from math import isfinite
from typing import ClassVar

import probatio
from aiohttp import web
from homeassistant.components.http import KEY_HASS, KEY_HASS_USER, HomeAssistantView
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import CONF_ENTITY_ID
from homeassistant.util.file import WriteError

from .analysis import resolve_entity_id
from .comparison_api import ID, REGION, RESPONSE_HEADERS, cache_capture, cached_capture
from .comparison_tarsius import async_ensure_tarsius
from .const import CONF_IMAGE_KEY, CONF_MODULE, CONF_SOURCE_TYPE, DOMAIN, SourceType
from .images import ImageError, async_get_frame
from .meter import METER, METER_SEED, METER_SETTINGS, METER_UNITS, calibrate_meter, meter_source, seed_state


def _number(low: float, high: float, *, integer: bool = False):
    def validate(value: int | float) -> int | float:
        if (
            type(value) not in (int, float)
            or not low <= value <= high
            or not isfinite(value)
            or (integer and value % 1)
        ):
            raise probatio.Invalid("Number outside range")
        return int(value) if integer else float(value)

    return validate


_LAYOUT = probatio.Schema({
    probatio.Required("kind"): probatio.In(tuple(METER_UNITS)),
    probatio.Required("max_rate"): _number(0.000001, 1_000_000),
    probatio.Required("rotation"): _number(-180, 180),
    probatio.Required("wheels"): _number(1, 12, integer=True),
    probatio.Required("decimal_wheels"): _number(0, 12, integer=True),
    probatio.Required("digits"): REGION,
    probatio.Required("dials"): probatio.All(
        [{
            probatio.Required("region"): REGION,
            probatio.Required("counterclockwise"): bool,
        }],
        probatio.Length(max=8),
    ),
})
_REQUEST = probatio.Schema({
    probatio.Required("capture_id"): ID,
    probatio.Required("revision"): str,
    probatio.Required("settings"): _LAYOUT,
    probatio.Optional("initial_value"): _number(0, 10**12),
})

_REBASE = probatio.Schema({
    probatio.Required("revision"): str,
    probatio.Required("value"): _number(0, 10**12),
})


def _entry(request: web.Request, profile_id: str) -> ConfigEntry:
    if not request[KEY_HASS_USER].is_admin:
        raise web.HTTPForbidden
    entry = request.app[KEY_HASS].config_entries.async_get_entry(profile_id)
    if entry is None or entry.domain != DOMAIN or entry.data.get(CONF_MODULE) != METER:
        raise web.HTTPNotFound
    return entry


class MeterView(HomeAssistantView):
    """Access the meter editor, its fixed reference image and calibration test."""

    url = f"/api/{DOMAIN}/meter/{{profile_id}}"
    extra_urls: ClassVar[list[str]] = [f"{url}/{{operation}}"]
    name = f"api:{DOMAIN}:meter"

    def _error(self, reason: str, status: int = 422) -> web.Response:
        return self.json({"reason": reason}, status_code=status, headers=RESPONSE_HEADERS)

    async def get(
        self, request: web.Request, profile_id: str, operation: str | None = None
    ) -> web.Response:
        entry = _entry(request, profile_id)
        hass = request.app[KEY_HASS]
        data = entry.data
        if operation is None:
            settings = {
                key: value
                for key, value in data.get(METER_SETTINGS, {}).items()
                if key not in ("calibration", "source")
            }
            return self.json({
                "settings": settings,
                "initialized": METER_SEED in data,
                "revision": entry.modified_at.isoformat(),
            }, headers=RESPONSE_HEADERS)
        if operation != "capture":
            raise web.HTTPNotFound
        try:
            frame = await async_get_frame(
                hass, SourceType(data[CONF_SOURCE_TYPE]),
                resolve_entity_id(hass, data.get(CONF_ENTITY_ID)), data[CONF_IMAGE_KEY],
            )
            if entry.data is not data or hass.config_entries.async_get_entry(profile_id) is not entry:
                return self._error("meter_settings_changed", 409)
            revision = entry.modified_at.isoformat()
            capture_id = cache_capture(request, profile_id, frame, revision)
        except ImageError as err:
            return self._error(err.reason)
        return web.Response(
            body=frame.content, content_type=frame.content_type,
            headers={
                **RESPONSE_HEADERS,
                "X-Image-Lab-Capture": capture_id,
                "X-Image-Lab-Revision": revision,
            },
        )

    async def post(
        self, request: web.Request, profile_id: str, operation: str | None = None
    ) -> web.Response:
        entry = _entry(request, profile_id)
        if operation == "rebase":
            return await self._rebase(request, entry)
        if operation not in ("test", "save"):
            raise web.HTTPNotFound
        try:
            values = _REQUEST(await request.json())
        except (ValueError, probatio.Invalid):
            return self._error("meter_invalid_settings", 400)

        revision = values["revision"]
        if revision != entry.modified_at.isoformat():
            return self._error("meter_settings_changed", 409)
        frame = cached_capture(request, profile_id, values["capture_id"], revision)
        if frame is None:
            return self._error("meter_capture_expired", 409)
        settings = values["settings"]
        whole = settings["wheels"] - settings["decimal_wheels"]
        initial = values.get("initial_value")
        if whole < 1 or (initial is not None and initial >= 10**whole):
            return self._error("meter_invalid_settings", 400)
        hass = request.app[KEY_HASS]
        try:
            await async_ensure_tarsius(hass)
            result, calibration = await hass.async_add_executor_job(calibrate_meter, frame, settings)
        except ImageError as err:
            return self._error(err.reason)
        if operation == "test":
            return self.json({**result.data, "reason": result.reason}, headers=RESPONSE_HEADERS)

        coordinator = entry.runtime_data if entry.state is ConfigEntryState.LOADED else None
        if coordinator is None:
            return self._error("profile_unavailable")
        async with coordinator.analysis_lock:
            if (
                revision != entry.modified_at.isoformat()
                or hass.config_entries.async_get_entry(profile_id) is not entry
                or entry.runtime_data is not coordinator
                or entry.state is not ConfigEntryState.LOADED
            ):
                return self._error("meter_settings_changed", 409)
            data = dict(entry.data)
            if METER_SEED in data:
                saved = data[METER_SETTINGS]
                if (
                    initial is not None or saved["kind"] != settings["kind"]
                    or saved["wheels"] - saved["decimal_wheels"] != whole
                ):
                    return self._error("meter_fixed_scale", 400)
            elif initial is not None:
                data[METER_SEED] = seed_state(initial)
            data[METER_SETTINGS] = {
                **settings, "calibration": calibration, "source": meter_source(data)
            }
            changed = hass.config_entries.async_update_entry(entry, data=data)
            if changed:
                hass.config_entries.async_schedule_reload(entry.entry_id)
        return self.json({**result.data, "reason": result.reason}, headers=RESPONSE_HEADERS)


    async def _rebase(self, request: web.Request, entry: ConfigEntry) -> web.Response:
        try:
            values = _REBASE(await request.json())
        except (ValueError, probatio.Invalid):
            return self._error("meter_invalid_settings", 400)
        coordinator = entry.runtime_data if entry.state is ConfigEntryState.LOADED else None
        if coordinator is None:
            return self._error("profile_unavailable")
        try:
            await coordinator.async_rebase_meter(values["value"], values["revision"])
        except ImageError as err:
            return self._error(err.reason, 409 if err.reason == "meter_settings_changed" else 422)
        except (WriteError, OSError):
            return self._error("storage_error")
        return self.json({"value": values["value"]}, headers=RESPONSE_HEADERS)
