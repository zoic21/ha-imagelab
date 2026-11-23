"""Publish the latest production analysis through a Home Assistant coordinator."""

import asyncio
import logging
from collections import defaultdict
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timedelta
from urllib.parse import parse_qs

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import ATTR_ENTITY_PICTURE, CONF_ENTITY_ID, STATE_UNAVAILABLE, Platform
from homeassistant.core import HomeAssistant, ServiceResponse, State, callback
from homeassistant.helpers.event import (
    async_track_entity_registry_updated_event,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)
from homeassistant.util.file import WriteError

from .analysis import AnalysisResult, async_analyze, resolve_entity_id
from .comparison_store import get_comparison_store
from .const import CONF_MODULE, CONF_PROFILE_ID, CONF_SOURCE_TYPE, DOMAIN, SourceType
from .images import ImageError, ImageFrame, async_get_frame
from .meter import (
    METER, METER_OUTPUT, METER_SEED, METER_SETTINGS, meter_entity_values, rebase_meter_state,
)
from .result_store import Observation, get_result_store

_LOGGER = logging.getLogger(__name__)

OUTPUTS = {
    "comparison": ("enum", "binary"),
    "object_detection": ("occupancy", "count"),
    "palette": ("color",),
    METER: (METER_OUTPUT,),
}
BINARY_CLASSES = (
    "opening",
    "door",
    "garage_door",
    "window",
    "occupancy",
    "motion",
    "problem",
    "running",
    "generic",
)


def artwork_signature(state: State | None) -> tuple[str | None, ...]:
    """Compare picture attributes, ignoring rotating proxy access tokens."""
    if state is None or state.state == STATE_UNAVAILABLE:
        return (None, None)

    def identity(url: str | None) -> str | None:
        if url and url.startswith("/api/media_player_proxy/"):
            path, _, query = url.partition("?")
            cache = parse_qs(query).get("cache", [""])[0]
            return f"{path}?cache={cache}"
        return url

    return tuple(
        identity(state.attributes.get(key))
        for key in (ATTR_ENTITY_PICTURE, "entity_picture_local")
    )


def scheduled_frame(
    hass: HomeAssistant, camera: str | None
) -> asyncio.Task[ImageFrame]:
    """Share an acquisition in progress without reusing a previously captured frame."""
    pending = hass.data.setdefault(f"{DOMAIN}.camera_frames", {})
    task = pending.get(camera)
    if task is None or task.done():
        task = hass.async_create_task(
            async_get_frame(hass, SourceType.CAMERA, camera, "")
        )
        pending[camera] = task

        def release(completed: asyncio.Task[ImageFrame]) -> None:
            if pending.get(camera) is completed:
                del pending[camera]

        task.add_done_callback(release)
    return task


class OutputCoordinator(DataUpdateCoordinator[ServiceResponse]):
    """Serialize, record and publish analyses of one profile."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, kind: str | None) -> None:
        self.kind = kind
        self.is_meter = entry.data[CONF_MODULE] == METER
        self.platform = (
            Platform.BINARY_SENSOR
            if kind in ("binary", "occupancy")
            else Platform.SENSOR if kind else None
        )
        self.unique_id = f"{entry.entry_id}_{kind}"
        self.analysis_lock = asyncio.Lock()
        self.store = (
            get_comparison_store(hass, entry.entry_id)
            if entry.data[CONF_MODULE] == "comparison"
            else get_result_store(hass, entry.entry_id)
        )
        self._confirmed: ServiceResponse | None = None
        self._retained: ServiceResponse | None = None
        self._unloaded = asyncio.Event()
        entry.async_on_unload(self._unloaded.set)
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} {entry.title}",
            update_interval=None,
        )

    @property
    def entity_response(self) -> ServiceResponse | None:
        """Keep a rejected transition out of the entity while returning the observation."""
        return self._retained if self._retained is not None else self.data

    async def async_initialize(self) -> None:
        """Publish a first observation without delaying setup or replacing a newer one."""
        async with self.analysis_lock:
            if self._unloaded.is_set():
                return
            if self.is_meter:
                if self._retained is not None:
                    return
                try:
                    state = await self.store.async_meter_state()
                except (ImageError, OSError):
                    _LOGGER.exception("Could not restore the meter index for %s", self.name)
                    return
                if state := state or self.config_entry.data.get(METER_SEED):
                    self._retained = {"status": "ok", "data": meter_entity_values(state)}
                response = self._retained
            elif self.data is None:
                result, _ = await self._observe()
                response = result.response
            else:
                return
            if not self._unloaded.is_set() and response is not None:
                self.async_set_updated_data(response)

    async def async_rebase_meter(self, value: float, revision: str) -> None:
        """Apply a verified meter reading between analyses."""
        async def run() -> None:
            entry = self.config_entry
            async with self.analysis_lock:
                if (
                    self._unloaded.is_set()
                    or entry.state is not ConfigEntryState.LOADED
                    or entry.runtime_data is not self
                    or entry.modified_at.isoformat() != revision
                ):
                    raise ImageError("meter_settings_changed")
                if (seed := entry.data.get(METER_SEED)) is None:
                    raise ImageError("meter_unconfirmed")
                settings = entry.data[METER_SETTINGS]
                if value >= 10 ** (settings["wheels"] - settings["decimal_wheels"]):
                    raise ImageError("meter_invalid_settings")
                previous = await self.store.async_meter_state() or seed
                state = rebase_meter_state(previous, value)
                await self.store.async_set_meter_state(state)
                if not self._unloaded.is_set():
                    self._retained = {
                        "status": "ok",
                        "data": {**meter_entity_values(state), "reading_status": "rebased"},
                    }
                    self.async_set_updated_data(self._retained)

        await asyncio.shield(self.hass.async_create_task(run(), f"{self.name} rebase"))

    @callback
    def async_watch_artwork(self) -> None:
        """Refresh this output when the chosen media player's picture changes."""
        entry = self.config_entry
        subscriptions: list[Callable[[], None]] = []

        @callback
        def unsubscribe() -> None:
            while subscriptions:
                subscriptions.pop()()

        @callback
        def artwork_changed(event) -> None:
            if artwork_signature(event.data["old_state"]) != artwork_signature(event.data["new_state"]):
                entry.async_create_background_task(
                    self.hass, self.async_request_refresh(), f"{self.name} artwork",
                    eager_start=False,
                )

        @callback
        def entity_renamed(event) -> None:
            if "old_entity_id" in event.data:
                unsubscribe()
                subscribe(event.data["entity_id"])

        def subscribe(entity_id: str) -> None:
            subscriptions.extend((
                async_track_state_change_event(self.hass, entity_id, artwork_changed),
                async_track_entity_registry_updated_event(self.hass, entity_id, entity_renamed),
            ))

        if entity_id := resolve_entity_id(self.hass, entry.data[CONF_ENTITY_ID]):
            subscribe(entity_id)
            entry.async_on_unload(unsubscribe)

    def _state_key(self, response: ServiceResponse | None) -> str | int | bool | None:
        if not response or response["status"] != "ok":
            return None
        data = response["data"]
        if self.kind in ("binary", "enum"):
            state = data.get("state_id")
            if self.kind == "binary" and state not in (
                self.config_entry.options["on_state"],
                self.config_entry.options["off_state"],
            ):
                return None
            return state
        if self.kind == "count":
            return None if data.get("truncated") else data.get("count")
        return data.get("detected" if self.kind == "occupancy" else "dominant_hex")

    async def _measure(
        self, frame: asyncio.Task[ImageFrame] | None = None
    ) -> AnalysisResult:
        entry = self.config_entry
        first = await async_analyze(self.hass, entry.entry_id, scheduled_capture=frame)
        if self.is_meter:
            return first
        delay = entry.options.get("confirmation_seconds", 0)
        candidate = self._state_key(first.response)
        baseline = self._state_key(self._confirmed)
        if (
            not delay
            or entry.data[CONF_SOURCE_TYPE] != SourceType.CAMERA
            or candidate is None
            or baseline is None
            or candidate == baseline
        ):
            if candidate is not None:
                self._confirmed = first.response
            self._retained = None
            return first

        if frame is not None and entry.data[CONF_MODULE] == "comparison":
            await self._save_observation(first, manual=False)

        # Unloading the profile wakes the delay without taking another snapshot.
        try:
            await asyncio.wait_for(self._unloaded.wait(), delay)
        except TimeoutError:
            pass
        if self._unloaded.is_set():
            return AnalysisResult({
                **first.response,
                "status": "error",
                "data": {},
                "reason": "profile_unavailable",
            })

        confirmation_frame = None
        if frame is not None:
            camera = resolve_entity_id(self.hass, entry.data[CONF_ENTITY_ID])
            confirmation_frame = scheduled_frame(self.hass, camera)
        second = await async_analyze(
            self.hass, entry.entry_id, scheduled_capture=confirmation_frame
        )
        if second.response["status"] == "error":
            self._retained = None
            return replace(second, response={**second.response, "confirmation": "failed"})
        if self._state_key(second.response) != candidate:
            self._retained = self._confirmed
            return replace(second, response={**second.response, "confirmation": "disagreed"})
        self._confirmed = second.response
        self._retained = None
        return replace(second, response={**second.response, "confirmation": "confirmed"})

    async def _save_observation(
        self, result: AnalysisResult, manual: bool
    ) -> Observation | None:
        if result.frame is not None and not self._unloaded.is_set():
            try:
                if self.is_meter:
                    return await self.store.async_record(
                        result.frame, result.response, manual, meter_state=result.meter_state
                    )
                return await self.store.async_record(result.frame, result.response, manual)
            except (ImageError, OSError, WriteError):
                _LOGGER.exception("Could not save analysis for %s", self.name)
        return None

    async def _observe(
        self, frame: asyncio.Task[ImageFrame] | None = None, *, manual: bool = False
    ) -> tuple[AnalysisResult, Observation | None]:
        result = await self._measure(frame)
        observation = await self._save_observation(result, manual)
        if self.is_meter:
            previous = (self._retained or {}).get("data", {})
            values = {key: previous[key] for key in ("meter_value", "meter_total") if key in previous}
            if observation is not None and result.meter_state is not None:
                values = meter_entity_values(result.meter_state)
            if values:
                data = {
                    **result.response["data"],
                    **values,
                    "reading_status": result.response.get("reason", "accepted"),
                }
                if result.frame is not None and observation is None:
                    data = {**values, "reading_status": "storage_error"}
                self._retained = {"status": "ok", "data": data}
            if result.frame is not None and observation is None:
                return AnalysisResult({
                    **result.response, "status": "error", "data": {}, "reason": "storage_error",
                }), None
        return result, observation

    async def _async_update_data(self) -> ServiceResponse:
        async with self.analysis_lock:
            result, _ = await self._observe()
            return result.response

    async def async_run_manual(self) -> tuple[AnalysisResult, Observation | None]:
        """Use the same confirmation and entity publication as automatic analyses."""

        async def run() -> tuple[AnalysisResult, Observation | None]:
            async with self.analysis_lock:
                try:
                    result, observation = await self._observe(manual=True)
                except Exception as err:
                    if not self._unloaded.is_set():
                        self.async_set_update_error(err)
                        _LOGGER.exception("Manual analysis failed for %s", self.name)
                    return AnalysisResult({
                        CONF_PROFILE_ID: self.config_entry.entry_id,
                        "status": "error",
                        "data": {},
                        "reason": "analysis_failed",
                    }), None
                if not self._unloaded.is_set():
                    self.async_set_updated_data(result.response)
                return result, observation

        return await asyncio.shield(self.hass.async_create_task(run(), self.name))

    async def async_process_capture(self, frame: asyncio.Task[ImageFrame]) -> None:
        async with self.analysis_lock:
            if self._unloaded.is_set():
                return
            result, _ = await self._observe(frame)
            if not self._unloaded.is_set():
                self.async_set_updated_data(result.response)


class CameraSchedule:
    """Align camera profiles to one minute clock and share a frame when due together."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.profiles: dict[OutputCoordinator, int] = {}
        self.active: set[OutputCoordinator] = set()
        self.minute = 0
        self.cancel: Callable[[], None] | None = None

    @callback
    def subscribe(
        self, coordinator: OutputCoordinator, minutes: int
    ) -> Callable[[], None]:
        self.profiles[coordinator] = minutes
        if self.cancel is None:
            self.cancel = async_track_time_interval(
                self.hass, self.tick, timedelta(minutes=1)
            )

        @callback
        def remove() -> None:
            self.profiles.pop(coordinator, None)
            if not self.profiles and self.cancel:
                self.cancel()
                self.cancel = None
                self.minute = 0

        return remove

    async def tick(self, now: datetime) -> None:
        self.minute += 1
        due = defaultdict(list)
        for coordinator, minutes in self.profiles.items():
            if self.minute % minutes == 0:
                entry = coordinator.config_entry
                camera = resolve_entity_id(self.hass, entry.data[CONF_ENTITY_ID])
                due[camera].append(coordinator)
        await asyncio.gather(
            *(self._run(camera, group) for camera, group in due.items())
        )

    async def _run(self, camera: str, group: list[OutputCoordinator]) -> None:
        group = [c for c in group if c in self.profiles and c not in self.active]
        if not group:
            return
        frame = scheduled_frame(self.hass, camera)
        self.active.update(group)

        async def process(coordinator: OutputCoordinator) -> None:
            try:
                await coordinator.async_process_capture(frame)
            except Exception as err:
                coordinator.async_set_update_error(err)
                _LOGGER.exception("Zone analysis failed for %s", coordinator.name)
            finally:
                self.active.discard(coordinator)

        # Consume the acquisition exception even when every profile unloads first.
        await asyncio.gather(
            frame, *(process(c) for c in group), return_exceptions=True
        )


class OutputEntity(CoordinatorEntity[OutputCoordinator]):
    """Share naming, identity and availability across the two entity platforms."""

    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry.runtime_data)
        self._attr_name = entry.title
        self._attr_unique_id = self.coordinator.unique_id

    @property
    def available(self) -> bool:
        response = self.coordinator.entity_response
        return super().available and (response is None or response["status"] != "error")

    @property
    def result(self) -> dict:
        response = self.coordinator.entity_response
        return response["data"] if response and response["status"] == "ok" else {}

    @property
    def extra_state_attributes(self) -> dict | None:
        result = self.result
        if not result:
            return None
        if self.coordinator.kind in ("occupancy", "count"):
            keys = ("objects", "counts", "count", "truncated")
        elif self.coordinator.kind == "color":
            keys = ("palette_hex", "palette_rgb", "dominant_rgb", "extracted_count", "repeated_count")
        elif self.coordinator.kind == METER_OUTPUT:
            keys = ("candidate", "confidence", "reading_status")
        else:
            return None
        return {key: result[key] for key in keys if key in result}
