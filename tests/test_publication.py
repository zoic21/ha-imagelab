"""Check writes from the inline publication form."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import probatio
import pytest

from custom_components.image_lab import publication


def profile(module="comparison", source="camera", **options):
    return SimpleNamespace(
        entry_id="profile", domain="image_lab", disabled_by=None, pref_disable_polling=False,
        data={"module": module, "source_type": source}, options=options,
    )


def config_entries(entry):
    def update(current, *, options, pref_disable_polling):
        changed = current.options != options or current.pref_disable_polling != pref_disable_polling
        current.options = options
        current.pref_disable_polling = pref_disable_polling
        return changed

    return SimpleNamespace(
        async_get_entry=Mock(return_value=entry), async_update_entry=Mock(side_effect=update),
        async_reload=AsyncMock(return_value=True),
    )


def test_combined_publication_save_preserves_existing_options_and_reloads_once(monkeypatch):
    async def run():
        entry = profile(output="enum", interval_minutes=5, confirmation_seconds=10, extra_option="keep")
        entry.pref_disable_polling = True
        entries = config_entries(entry)
        async def executor(job):
            return job()

        jobs = []
        hass = SimpleNamespace(
            config_entries=entries, async_add_executor_job=executor,
            async_create_background_task=lambda task, _name, **_: jobs.append(asyncio.create_task(task)),
        )
        store = SimpleNamespace(lock=asyncio.Lock(), load=lambda: {"states": [{"id": "open"}, {"id": "closed"}]})
        monkeypatch.setattr(publication, "get_comparison_store", lambda *_: store)
        connection = Mock(user=SimpleNamespace(is_admin=True))
        changes = {
            "output": "binary", "binary_class": "garage_door", "on_state": "open", "off_state": "closed",
            "interval_minutes": 15, "confirmation_seconds": 0,
        }
        publication.async_set_publication(hass, connection, {"id": 1, "profile_id": "profile", "settings": changes})
        await jobs[0]
        assert entry.options == {**changes, "extra_option": "keep"}
        assert entry.pref_disable_polling is False
        entries.async_update_entry.assert_called_once()
        entries.async_reload.assert_awaited_once_with("profile")
        connection.send_result.assert_called_once_with(1, publication.publication_settings(entry))

    asyncio.run(run())


@pytest.mark.parametrize(("states", "on", "off", "reason"), [
    ({"open"}, "open", "closed", "need_two_states"),
    ({"open", "closed"}, "open", "missing", "state_removed"),
    ({"open", "closed"}, "open", "open", "different_states"),
])
def test_invalid_binary_mapping_does_not_write_options(states, on, off, reason):
    entry = profile()
    entries = config_entries(entry)
    with pytest.raises(ValueError, match=reason):
        publication._update_options(SimpleNamespace(config_entries=entries), entry, {
            "output": "binary", "on_state": on, "off_state": off,
        }, states)
    entries.async_update_entry.assert_not_called()


def test_disabling_publication_keeps_the_camera_schedule():
    entry = profile(output="binary", on_state="open", off_state="closed", binary_class="opening",
                    interval_minutes=15, confirmation_seconds=20, extra_option="keep")
    hass = SimpleNamespace(config_entries=config_entries(entry))
    publication._update_options(hass, entry, {"output": "none"}, set())
    assert entry.options == {"interval_minutes": 15, "confirmation_seconds": 0, "extra_option": "keep"}


def test_upload_cannot_set_camera_settings():
    entry = profile(module="palette", source="upload")
    entries = config_entries(entry)
    with pytest.raises(ValueError, match="invalid_publication"):
        publication._update_options(SimpleNamespace(config_entries=entries), entry, {"interval_minutes": 5}, set())
    entries.async_update_entry.assert_not_called()


@pytest.mark.parametrize("value", [True, -1, 61, 1.5])
def test_confirmation_requires_whole_seconds_between_zero_and_sixty(value):
    with pytest.raises(probatio.Invalid):
        publication._SETTINGS({"confirmation_seconds": value})
