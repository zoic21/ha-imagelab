"""Regression checks for the meter's cumulative index."""

import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from custom_components.image_lab.images import validate_image
from custom_components.image_lab.meter import (
    _read,
    calibrate_meter,
    meter_entity_values,
    rebase_meter_state,
    seed_state,
)
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


def test_meter_improves_low_contrast_wheels_without_accepting_a_blocked_frame(monkeypatch):
    meter = pytest.importorskip("tarsius.meter")
    raw_calibration = meter.Calibration(exposure=(meter.Exposure(spread=16),) * 3)
    enhanced_calibration = meter.Calibration(exposure=(meter.Exposure(spread=50),) * 3)
    raw = meter.MeterReading(0, 0, None, 0.59, 0, 1, wheels=(meter.Reading(0, 0.73),) * 3)
    enhanced = meter.MeterReading(
        84.3, 84.3, None, 0.95, 0, 1, wheels=(meter.Reading(4.3, 0.97),) * 3
    )

    def calibrate(_, content, _layout):
        return enhanced_calibration if isinstance(content, Image.Image) else raw_calibration

    def read(_, content, layout, calibration):
        if isinstance(content, Image.Image):
            assert layout.rotation == 0
            assert calibration == enhanced_calibration
            return enhanced
        assert calibration == raw_calibration
        return raw

    monkeypatch.setattr(meter.MeterReader, "calibrate", calibrate)
    monkeypatch.setattr(meter.MeterReader, "read", read)
    photo = frame()
    profile = {**settings(), "rotation": 12}
    result, calibration = calibrate_meter(photo, profile)
    assert result.data["value"] == 84.3
    profile["calibration"] = calibration
    previous = seed_state(84.3)
    result, _ = _read(photo, profile, previous, False)
    assert result.data["value"] == 84.3

    raw = replace(
        raw.rejected(meter.Rejection.FAULT),
        wheels=(meter.Reading(0, 0.73, fault=meter.Fault.GLARE), *raw.wheels[1:]),
    )
    result, state = _read(photo, profile, previous, False)
    assert result.reason == "meter_fault"
    assert state["value"] == previous["value"]
    assert state["at"] == previous["at"]


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



@pytest.mark.parametrize("corrected", (250.0, 2500.0))
def test_rebase_resumes_consumption_from_the_corrected_index(monkeypatch, corrected):
    meter = pytest.importorskip("tarsius.meter")
    monkeypatch.setattr(meter.Calibration, "from_dict", lambda _: None)
    candidate = corrected + 0.125
    monkeypatch.setattr(
        meter.MeterReader, "read",
        lambda *_: meter.MeterReading(candidate, candidate, None, 0.99, 0, 0.001),
    )
    previous = {"value": 520.125, "at": datetime.now(UTC).isoformat()}
    state = rebase_meter_state(previous, corrected)
    assert meter_entity_values(state) == {"meter_value": corrected, "meter_total": 520.125}
    profile = {**settings(), "wheels": 7, "decimal_wheels": 3, "calibration": {}}
    state["at"] = (datetime.now(UTC) - timedelta(hours=1)).isoformat()

    result, updated = _read(frame(), profile, state, False)
    assert result.reason is None
    assert meter_entity_values(updated) == {"meter_value": candidate, "meter_total": 520.25}

    second = rebase_meter_state(updated, 100)
    assert meter_entity_values(second) == {"meter_value": 100, "meter_total": 520.25}


def test_rebase_persists_without_pruning_previous_observations(tmp_path):
    async def executor(fn, *args):
        return fn(*args)

    hass = SimpleNamespace(
        config=SimpleNamespace(path=tmp_path.joinpath),
        config_entries=SimpleNamespace(async_get_entry=lambda _: object()),
        async_add_executor_job=executor,
    )
    store = ResultStore(hass, "meter")
    response = {"status": "unknown", "data": {"candidate": 250}}
    previous = {"value": 100.0, "at": datetime.now(UTC).isoformat()}
    observation = store._record(frame(), response, True, previous)
    rebased = rebase_meter_state(previous, 250)
    asyncio.run(store.async_set_meter_state(rebased))
    saved = ResultStore(hass, "meter").load()
    assert saved["history"] == [observation]
    assert (store.images / observation["id"]).is_file()
    assert saved["meter_state"] == rebased


def test_rebased_sensor_publishes_the_continuous_total_and_exposes_the_index():
    coordinator = SimpleNamespace(
        kind="meter_index",
        unique_id="meter_sensor",
        last_update_success=True,
        entity_response={
            "status": "ok",
            "data": {"meter_value": 2500.125, "meter_total": 520.25},
        },
    )
    sensor = ImageLabSensor(SimpleNamespace(
        title="Water meter", runtime_data=coordinator, data={"meter_settings": settings()}
    ))
    assert sensor.native_value == 520.25
    assert sensor.extra_state_attributes == {"meter_index": 2500.125}
