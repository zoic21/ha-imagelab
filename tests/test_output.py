"""Check how analysis outcomes translate to Home Assistant entity states."""

from types import SimpleNamespace

from custom_components.image_lab.binary_sensor import ImageLabBinarySensor
from custom_components.image_lab.sensor import ImageLabSensor


def entry(kind, **options):
    coordinator = SimpleNamespace(
        kind=kind, unique_id="profile_" + kind, last_update_success=True, data=None
    )
    return SimpleNamespace(title="Camera", runtime_data=coordinator, options=options)


def test_binary_mapping_never_treats_uncertainty_as_closed():
    profile = entry("binary", on_state="a", off_state="b", binary_class="opening")
    entity = ImageLabBinarySensor(profile)
    assert entity.is_on is None
    for state, expected in (("a", True), ("b", False), ("unmapped", None)):
        profile.runtime_data.data = {"status": "ok", "data": {"state_id": state}}
        assert entity.is_on is expected
    profile.runtime_data.data = {"status": "unknown", "data": {"best_state": "Closed"}}
    assert entity.available and entity.is_on is None
    profile.runtime_data.data = {"status": "error", "data": {}}
    assert not entity.available


def test_detection_publishes_zero_and_rejects_truncated_counts():
    profile = entry("count")
    sensor = ImageLabSensor(profile)
    profile.runtime_data.data = {
        "status": "ok",
        "data": {"count": 0, "truncated": False},
    }
    assert sensor.native_value == 0
    profile.runtime_data.data = {
        "status": "ok",
        "data": {"count": 100, "truncated": True},
    }
    assert sensor.native_value is None
    profile = entry("occupancy")
    binary = ImageLabBinarySensor(profile)
    profile.runtime_data.data = {"status": "ok", "data": {"detected": False}}
    assert binary.is_on is False
