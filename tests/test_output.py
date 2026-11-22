"""Check how analysis outcomes translate to Home Assistant entity states."""

from types import SimpleNamespace

from homeassistant.core import State

from custom_components.image_lab.binary_sensor import ImageLabBinarySensor
from custom_components.image_lab.output import artwork_signature
from custom_components.image_lab.sensor import ImageLabSensor


def entry(kind, **options):
    coordinator = SimpleNamespace(
        kind=kind,
        unique_id="profile_" + kind,
        last_update_success=True,
        entity_response=None,
    )
    return SimpleNamespace(title="Camera", runtime_data=coordinator, options=options)


def test_binary_mapping_never_treats_uncertainty_as_closed():
    profile = entry("binary", on_state="a", off_state="b", binary_class="opening")
    entity = ImageLabBinarySensor(profile)
    assert entity.is_on is None
    for state, expected in (("a", True), ("b", False), ("unmapped", None)):
        profile.runtime_data.entity_response = {
            "status": "ok",
            "data": {"state_id": state},
        }
        assert entity.is_on is expected
    profile.runtime_data.entity_response = {
        "status": "unknown",
        "data": {"best_state": "Closed"},
    }
    assert entity.available and entity.is_on is None
    profile.runtime_data.entity_response = {"status": "error", "data": {}}
    assert not entity.available


def test_detection_publishes_zero_and_rejects_truncated_counts():
    profile = entry("count")
    sensor = ImageLabSensor(profile)
    profile.runtime_data.entity_response = {
        "status": "ok",
        "data": {"count": 0, "truncated": False},
    }
    assert sensor.native_value == 0
    profile.runtime_data.entity_response = {
        "status": "ok",
        "data": {"count": 100, "truncated": True},
    }
    assert sensor.native_value is None
    profile = entry("occupancy")
    binary = ImageLabBinarySensor(profile)
    profile.runtime_data.entity_response = {"status": "ok", "data": {"detected": False}}
    assert binary.is_on is False


def test_detection_entities_expose_the_same_details():
    data = {
        "detected": True,
        "count": 1,
        "counts": {"car": 1},
        "objects": [{"label": "car", "confidence": 0.88, "box": {"x_min": 0.3}}],
        "truncated": False,
    }
    for kind, entity_type in (("count", ImageLabSensor), ("occupancy", ImageLabBinarySensor)):
        profile = entry(kind)
        entity = entity_type(profile)
        profile.runtime_data.entity_response = {"status": "ok", "data": data}
        assert entity.extra_state_attributes == {
            key: value for key, value in data.items() if key != "detected"
        }
        profile.runtime_data.entity_response = {"status": "error", "data": {}}
        assert entity.extra_state_attributes is None


def test_color_sensor_exposes_the_whole_palette():
    profile = entry("color")
    sensor = ImageLabSensor(profile)
    profile.runtime_data.entity_response = {
        "status": "ok",
        "data": {
            "dominant_hex": "#FF0000",
            "palette_hex": ["#FF0000", "#0000FF"],
            "palette_rgb": [[255, 0, 0], [0, 0, 255]],
        },
    }
    assert sensor.native_value == "#FF0000"
    assert sensor.extra_state_attributes["palette_hex"] == ["#FF0000", "#0000FF"]
    assert sensor.extra_state_attributes["palette_rgb"] == [[255, 0, 0], [0, 0, 255]]


def test_artwork_signature_ignores_token_rotation_and_playback_attributes():
    def playing(query, position):
        return State(
            "media_player.test", "playing",
            {"entity_picture": f"/api/media_player_proxy/media_player.test?{query}",
             "media_position": position},
        )

    before = artwork_signature(playing("token=old&cache=one", 10))
    assert artwork_signature(playing("cache=one&token=new", 20)) == before
    assert artwork_signature(playing("token=new&cache=two", 20)) != before
    assert artwork_signature(None) != before


def test_confirmation_compares_state_ids_and_keeps_rejected_changes_out_of_entity():
    import asyncio
    from unittest.mock import AsyncMock, patch

    from custom_components.image_lab.output import OutputCoordinator

    async def run():
        coord = object.__new__(OutputCoordinator)
        coord.kind = "binary"
        coord.hass = None
        coord.config_entry = SimpleNamespace(
            entry_id="profile",
            options={"on_state": "a", "off_state": "b", "confirmation_seconds": 0.001},
            data={"source_type": "camera"},
        )
        coord._unloaded = asyncio.Event()
        coord._retained = None
        coord.data = None

        def observation(state=None, status="ok"):
            return SimpleNamespace(
                response={"status": status, "data": {"state_id": state}}
            )

        async def measure(*observations):
            with patch(
                "custom_components.image_lab.output.async_analyze",
                AsyncMock(side_effect=observations),
            ) as analyze:
                coord.data = await coord._measure()
                assert analyze.await_count == len(observations)
            return coord.data.get("confirmation")

        assert await measure(observation("a")) is None
        assert await measure(observation("a")) is None
        assert (
            await measure(observation("b"), observation(status="unknown"))
            == "disagreed"
        )
        assert coord.entity_response["data"]["state_id"] == "a"
        assert await measure(observation("b"), observation("a")) == "disagreed"
        assert await measure(observation("b"), observation("b")) == "confirmed"
        assert coord.entity_response["data"]["state_id"] == "b"
        assert await measure(observation("a"), observation(status="error")) == "failed"
        assert coord.entity_response["status"] == "error"
        await measure(observation("b"))
        coord._unloaded.set()
        await measure(observation("a"))
        assert coord.data["reason"] == "profile_unavailable"

    asyncio.run(run())
