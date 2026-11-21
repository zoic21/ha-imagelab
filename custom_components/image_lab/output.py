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
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN} {entry.title}",
            update_interval=None,
        )

    async def _async_update_data(self) -> ServiceResponse:
        async with self.analysis_lock:
            return (await async_analyze(self.hass, self.config_entry.entry_id)).response

    async def async_process_capture(self, frame: asyncio.Task[ImageFrame]) -> None:
        async with self.analysis_lock:
            if getattr(self.config_entry, "runtime_data", None) is not self:
                return
            result = await async_analyze(
                self.hass, self.config_entry.entry_id, scheduled_capture=frame
            )
            if getattr(self.config_entry, "runtime_data", None) is self:
                self.async_set_updated_data(result.response)


class CameraSchedule:
    """Align camera profiles to one minute clock and share a frame when due together."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.profiles: dict[OutputCoordinator, int] = {}
        self.active: set[str] = set()
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
        group = [c for c in group if c in self.profiles]
        if camera in self.active or not group:
            return
        self.active.add(camera)
        try:
            frame = self.hass.async_create_task(
                async_get_frame(self.hass, SourceType.CAMERA, camera, "")
            )
            jobs = [c.async_process_capture(frame) for c in group]
            # Consume the acquisition exception even if all entries unload mid-capture.
            results = await asyncio.gather(frame, *jobs, return_exceptions=True)
            for coordinator, result in zip(group, results[1:]):
                if isinstance(result, Exception):
                    coordinator.async_set_update_error(result)
                    _LOGGER.error(
                        "Zone analysis failed for %s", coordinator.name, exc_info=result
                    )
        finally:
            self.active.discard(camera)


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
        response = self.coordinator.data
        return super().available and (response is None or response["status"] != "error")

    @property
    def result(self) -> dict:
        response = self.coordinator.data
        return response["data"] if response and response["status"] == "ok" else {}
