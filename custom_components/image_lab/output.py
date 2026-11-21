"""Publish the latest production analysis through a Home Assistant coordinator."""

import logging
from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceResponse
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)

from .analysis import async_analyze
from .const import CONF_SOURCE_TYPE, DOMAIN, SourceType

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
        minutes = entry.options.get("interval_minutes", 0)
        interval = (
            timedelta(minutes=minutes)
            if minutes and entry.data[CONF_SOURCE_TYPE] == SourceType.CAMERA
            else None
        )
        super().__init__(
            hass,
            logging.getLogger(__name__),
            config_entry=entry,
            name=f"{DOMAIN} {entry.title}",
            update_interval=interval,
        )

    async def _async_update_data(self) -> ServiceResponse:
        return (await async_analyze(self.hass, self.config_entry.entry_id)).response


class OutputEntity(CoordinatorEntity[OutputCoordinator]):
    """Share naming, identity and availability across the two entity platforms."""

    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry.runtime_data)
        self._attr_name = entry.title
        self._attr_unique_id = self.coordinator.unique_id

    @property
    def available(self) -> bool:
        response = self.coordinator.data
        return super().available and (response is None or response["status"] != "error")

    @property
    def result(self) -> dict:
        response = self.coordinator.data
        return response["data"] if response and response["status"] == "ok" else {}
