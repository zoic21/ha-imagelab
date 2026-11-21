"""Publish the latest production analysis through a Home Assistant coordinator."""

import asyncio
import logging
from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_ENTITY_ID, Platform
from homeassistant.core import HomeAssistant, ServiceResponse, callback
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)

from .analysis import async_analyze, resolve_entity_id
from .const import CONF_SOURCE_TYPE, DOMAIN, SourceType
from .images import ImageFrame, async_get_frame

_LOGGER = logging.getLogger(__name__)

OUTPUTS = {
    "comparison": ("enum", "binary"),
    "object_detection": ("occupancy", "count"),
    "palette": ("color",),
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
    """Serialize manual and scheduled analyses, retaining only their response."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, kind: str) -> None:
        self.kind = kind
        self.platform = (
            Platform.BINARY_SENSOR
            if kind in ("binary", "occupancy")
            else Platform.SENSOR
        )
        self.unique_id = f"{entry.entry_id}_{kind}"
        self.analysis_lock = asyncio.Lock()
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
    ) -> ServiceResponse:
        entry = self.config_entry
        first = (
            await async_analyze(self.hass, entry.entry_id, scheduled_capture=frame)
        ).response
        delay = entry.options.get("confirmation_seconds", 0)
        previous = self.entity_response
        candidate = self._state_key(first)
        baseline = self._state_key(previous)
        if (
            not delay
            or entry.data[CONF_SOURCE_TYPE] != SourceType.CAMERA
            or candidate is None
            or baseline is None
            or candidate == baseline
        ):
            self._retained = None
            return first

        # Unloading the profile wakes the delay without taking another snapshot.
        try:
            await asyncio.wait_for(self._unloaded.wait(), delay)
        except TimeoutError:
            pass
        if self._unloaded.is_set():
            return {
                **first,
                "status": "error",
                "data": {},
                "reason": "profile_unavailable",
            }

        confirmation_frame = None
        if frame is not None:
            camera = resolve_entity_id(self.hass, entry.data[CONF_ENTITY_ID])
            confirmation_frame = scheduled_frame(self.hass, camera)
        second = (
            await async_analyze(
                self.hass, entry.entry_id, scheduled_capture=confirmation_frame
            )
        ).response
        if second["status"] == "error":
            self._retained = None
            return {**second, "confirmation": "failed"}
        if self._state_key(second) != candidate:
            self._retained = previous
            return {**second, "confirmation": "disagreed"}
        self._retained = None
        return {**second, "confirmation": "confirmed"}

    async def _async_update_data(self) -> ServiceResponse:
        async with self.analysis_lock:
            return await self._measure()

    async def async_process_capture(self, frame: asyncio.Task[ImageFrame]) -> None:
        async with self.analysis_lock:
            if self._unloaded.is_set():
                return
            response = await self._measure(frame)
            if not self._unloaded.is_set():
                self.async_set_updated_data(response)


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

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        entry = self.coordinator.config_entry
        minutes = entry.options.get("interval_minutes", 0)
        if (
            minutes
            and entry.data[CONF_SOURCE_TYPE] == SourceType.CAMERA
            and not entry.pref_disable_polling
        ):
            key = f"{DOMAIN}.camera_schedule"
            if key not in self.hass.data:
                self.hass.data[key] = CameraSchedule(self.hass)
            self.async_on_remove(
                self.hass.data[key].subscribe(self.coordinator, minutes)
            )

    @property
    def available(self) -> bool:
        response = self.coordinator.entity_response
        return super().available and (response is None or response["status"] != "error")

    @property
    def result(self) -> dict:
        response = self.coordinator.entity_response
        return response["data"] if response and response["status"] == "ok" else {}
