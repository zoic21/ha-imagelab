"""Regression checks for the meter's cumulative index."""

from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from custom_components.image_lab.images import validate_image
from custom_components.image_lab.meter import _read
from custom_components.image_lab.result_store import ResultStore
from custom_components.image_lab.sensor import ImageLabSensor


def frame():
    image = Image.new("RGB", (80, 40), "white")
    ImageDraw.Draw(image).rectangle((10, 5, 40, 30), fill="black")
    content = BytesIO()
    image.save(content, "PNG")
    return validate_image(content.getvalue())


def settings():
    return {
        "kind": "water",
        "wheels": 3,
        "decimal_wheels": 0,
        "rotation": 0,
        "digits": {"x": 0, "y": 0, "width": 1, "height": 1},
        "dials": [],
        "max_rate": 5,
    }


def test_meter_keeps_its_index_after_repeated_decreases_and_unwraps(monkeypatch):
    meter = pytest.importorskip("tarsius.meter")
    monkeypatch.setattr(meter.Calibration, "from_dict", lambda _: None)

    def simulate(candidate, baseline):
        def reading(*_):
            return meter.MeterReading(candidate, candidate, None, 0.99, 0, 1)
        monkeypatch.setattr(meter.MeterReader, "read", reading)
        return _read(frame(), {**settings(), "calibration": {}}, baseline, False)

    hour_ago = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    state = {"value": 520.0, "at": hour_ago}
    for _ in range(5):
        result, state = simulate(20, state)
        assert result.reason == "meter_decreased"
        assert state["value"] == 520.0
    result, _ = simulate(920, state)
    assert result.reason == "meter_too_fast"

    result, state = simulate(1, {"value": 999.0, "at": hour_ago})
    assert result.reason is None
    assert result.data["value"] == state["value"] == 1001.0

    result, state = simulate(123, None)
    assert result.reason == "meter_unconfirmed"
    assert state is None


def test_history_pruning_does_not_remove_the_last_accepted_index(tmp_path):
    hass = SimpleNamespace(config=SimpleNamespace(path=tmp_path.joinpath))
    store = ResultStore(hass, "meter")
    store._save({"history": [], "history_settings": {"mode": "all", "limit": 1}})
    state = {"value": 50.0, "at": datetime.now(UTC).isoformat()}
    store._record(frame(), {"status": "ok", "data": {}}, True, state)
    store._record(frame(), {"status": "unknown", "data": {}}, False)
    saved = ResultStore(hass, "meter").load()
    assert saved["meter_state"] == state
    assert len(saved["history"]) == 1
    assert saved["history"][0]["response"]["status"] == "unknown"


def test_water_index_sensor_has_energy_metadata():
    coordinator = SimpleNamespace(
        kind="meter_index",
        unique_id="meter_sensor",
        last_update_success=True,
        entity_response={"status": "ok", "data": {"meter_value": 0.0}},
    )
    sensor = ImageLabSensor(SimpleNamespace(
        title="Water meter", runtime_data=coordinator, data={"meter_settings": settings()}
    ))
    assert sensor.available
    assert sensor.native_value == 0.0
    assert sensor.device_class == "water"
    assert sensor.state_class == "total"
    assert sensor.native_unit_of_measurement == "m³"
