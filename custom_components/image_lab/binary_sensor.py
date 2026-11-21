"""Binary results from labelled states or object detection."""

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from .output import OutputEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities([ImageLabBinarySensor(entry)])


class ImageLabBinarySensor(OutputEntity, BinarySensorEntity):
    """Map only explicitly selected states to on and off."""

    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry)
        self._on = entry.options.get("on_state")
        self._off = entry.options.get("off_state")
        device_class = (
            "occupancy"
            if self.coordinator.kind == "occupancy"
            else entry.options["binary_class"]
        )
        if device_class != "generic":
            self._attr_device_class = BinarySensorDeviceClass(device_class)

    @property
    def is_on(self) -> bool | None:
        result = self.result
        if self.coordinator.kind == "occupancy":
            return result.get("detected")
        if state := result.get("state_id"):
            if state == self._on:
                return True
            if state == self._off:
                return False
        return None
