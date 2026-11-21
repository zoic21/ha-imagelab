"""Multi-state, object count and dominant color results."""

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .output import OutputEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities([ImageLabSensor(entry)])


class ImageLabSensor(OutputEntity, SensorEntity):
    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry)
        if self.coordinator.kind == "enum":
            self._attr_device_class = SensorDeviceClass.ENUM

    @property
    def options(self) -> list[str] | None:
        if self.coordinator.kind != "enum":
            return None
        response = self.coordinator.entity_response
        return list(response["data"].get("ref_counts", {})) if response else []

    @property
    def native_value(self) -> str | int | None:
        result = self.result
        if self.coordinator.kind == "count":
            return None if result.get("truncated") else result.get("count")
        if self.coordinator.kind == "color":
            return result.get("dominant_hex")
        return result.get("state")
