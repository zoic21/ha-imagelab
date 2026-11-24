"""Regression tests for temporary captures used by comparison and calibration."""

from types import SimpleNamespace

import pytest

from custom_components.image_lab import comparison_api
from custom_components.image_lab.images import ImageFrame


class CaptureRequest(dict):
    def __init__(self, hass, user_id):
        super().__init__({comparison_api.KEY_HASS_USER: SimpleNamespace(id=user_id)})
        self.app = {comparison_api.KEY_HASS: hass}


def test_only_the_same_user_and_profile_share_capture_slots():
    hass = SimpleNamespace(data={})
    alice = CaptureRequest(hass, "alice")
    bob = CaptureRequest(hass, "bob")
    frame = ImageFrame(b"jpeg", "image/jpeg", 1, 1)
    meter = comparison_api.cache_capture(alice, "meter", frame, "revision")
    comparison = comparison_api.cache_capture(bob, "door", frame)
    door_tests = [comparison_api.cache_capture(alice, "door", frame) for _ in range(5)]

    assert comparison_api.cached_capture(alice, "door", door_tests[0]) is None
    assert all(comparison_api.cached_capture(alice, "door", key) is frame for key in door_tests[1:])
    assert comparison_api.cached_capture(bob, "door", comparison) is frame
    assert comparison_api.cached_capture(alice, "meter", meter, "revision") is frame
    assert comparison_api.cached_capture(alice, "meter", meter, "other_revision") is None
    assert comparison_api.cached_capture(alice, "door", meter, "revision") is None
    assert comparison_api.cached_capture(bob, "meter", meter, "revision") is None


@pytest.mark.parametrize(("count_limit", "byte_limit"), [(2, 64), (64, 8)])
def test_global_limit_evicts_the_oldest_capture(monkeypatch, count_limit, byte_limit):
    monkeypatch.setattr(comparison_api, "_CAPTURE_MAX_COUNT", count_limit)
    monkeypatch.setattr(comparison_api, "_CAPTURE_MAX_BYTES", byte_limit)
    request = CaptureRequest(SimpleNamespace(data={}), "alice")
    frame = ImageFrame(b"jpeg", "image/jpeg", 1, 1)
    oldest = comparison_api.cache_capture(request, "first", frame)
    second = comparison_api.cache_capture(request, "second", frame)
    newest = comparison_api.cache_capture(request, "third", frame)

    assert comparison_api.cached_capture(request, "first", oldest) is None
    assert comparison_api.cached_capture(request, "second", second) is frame
    assert comparison_api.cached_capture(request, "third", newest) is frame


def test_expiry_and_profile_deletion_remove_captures(monkeypatch):
    now = 0
    monkeypatch.setattr(comparison_api, "monotonic", lambda: now)
    hass = SimpleNamespace(data={})
    alice = CaptureRequest(hass, "alice")
    bob = CaptureRequest(hass, "bob")
    frame = ImageFrame(b"jpeg", "image/jpeg", 1, 1)
    expired = comparison_api.cache_capture(alice, "door", frame)
    now = 1
    keep = comparison_api.cache_capture(alice, "gate", frame)
    deleted = comparison_api.cache_capture(bob, "door", frame)
    now = 300

    assert comparison_api.cached_capture(alice, "door", expired) is None
    assert comparison_api.cached_capture(bob, "door", deleted) is frame
    comparison_api.drop_captures(hass, "door")
    assert comparison_api.cached_capture(bob, "door", deleted) is None
    assert comparison_api.cached_capture(alice, "gate", keep) is frame
