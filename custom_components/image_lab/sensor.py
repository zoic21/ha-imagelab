"""Multi-state, object count, dominant color and meter results."""

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .meter import METER_OUTPUT, METER_SETTINGS, METER_UNITS
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
        elif self.coordinator.kind == METER_OUTPUT and (settings := entry.data.get(METER_SETTINGS)):
            kind = settings["kind"]
            self._attr_device_class = SensorDeviceClass(kind)
            self._attr_native_unit_of_measurement = METER_UNITS[kind]
            self._attr_state_class = SensorStateClass.TOTAL
            self._attr_suggested_display_precision = settings["decimal_wheels"] + len(settings["dials"]) + 1

    @property
    def options(self) -> list[str] | None:
        if self.coordinator.kind != "enum":
            return None
        response = self.coordinator.entity_response
        return list(response["data"].get("ref_counts", {})) if response else []

    @property
    def extra_state_attributes(self) -> dict | None:
        attributes = super().extra_state_attributes
        if self.coordinator.kind == METER_OUTPUT and (index := self.result.get("meter_value")) is not None:
            return {**(attributes or {}), "meter_index": index}
        return attributes

    @property
    def native_value(self) -> str | int | float | None:
        result = self.result
        if self.coordinator.kind == "count":
            return None if result.get("truncated") else result.get("count")
        if self.coordinator.kind == "color":
            return result.get("dominant_hex")
        if self.coordinator.kind == METER_OUTPUT:
            return result.get("meter_total", result.get("meter_value"))
        return result.get("state")
