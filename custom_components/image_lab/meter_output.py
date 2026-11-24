"""Publish a meter's persisted index and continuous total."""

import asyncio

from homeassistant.config_entries import ConfigEntryState

from .analysis import AnalysisResult
from .images import ImageError, ImageFrame
from .meter import METER_SEED, METER_SETTINGS, meter_entity_values, rebase_meter_state
from .output import OutputCoordinator
from .result_store import Observation


class MeterCoordinator(OutputCoordinator):
    """Restore, record and rebase readings under the profile's analysis lock."""

    async def async_initialize(self) -> None:
        """Restore the accepted index before publishing any new observations."""
        async with self.analysis_lock:
            if self._unloaded.is_set() or self._retained is not None:
                return
            try:
                state = await self.store.async_meter_state()
            except (ImageError, OSError):
                self.logger.exception("Could not restore the meter index for %s", self.name)
                return
            if state := state or self.config_entry.data.get(METER_SEED):
                self._retained = {"status": "ok", "data": meter_entity_values(state)}
                if not self._unloaded.is_set():
                    self.async_set_updated_data(self._retained)

    async def _observe(
        self, frame: asyncio.Task[ImageFrame] | None = None, *, manual: bool = False
    ) -> tuple[AnalysisResult, Observation | None]:
        result, observation = await super()._observe(frame, manual=manual)
        previous = (self._retained or {}).get("data", {})
        values = {key: previous[key] for key in ("meter_value", "meter_total") if key in previous}
        if result.frame is not None and observation is None:
            if values:
                self._retained = {"status": "ok", "data": {**values, "reading_status": "storage_error"}}
            return AnalysisResult({
                **result.response, "status": "error", "data": {}, "reason": "storage_error",
            }), None
        if observation is not None and result.meter_state is not None:
            values = meter_entity_values(result.meter_state)
        if values:
            self._retained = {
                "status": "ok",
                "data": {
                    **result.response["data"],
                    **values,
                    "reading_status": result.response.get("reason", "accepted"),
                },
            }
        return result, observation

    async def async_rebase_meter(self, value: float, revision: str) -> None:
        """Apply a verified meter reading between analyses."""
        async def run() -> None:
            entry = self.config_entry
            async with self.analysis_lock:
                if (
                    self._unloaded.is_set()
                    or entry.state is not ConfigEntryState.LOADED
                    or entry.runtime_data is not self
                    or entry.modified_at.isoformat() != revision
                ):
                    raise ImageError("meter_settings_changed")
                if (seed := entry.data.get(METER_SEED)) is None:
                    raise ImageError("meter_unconfirmed")
                settings = entry.data[METER_SETTINGS]
                if value >= 10 ** (settings["wheels"] - settings["decimal_wheels"]):
                    raise ImageError("meter_invalid_settings")
                previous = await self.store.async_meter_state() or seed
                state = rebase_meter_state(previous, value)
                await self.store.async_set_meter_state(state)
                if not self._unloaded.is_set():
                    self._retained = {
                        "status": "ok",
                        "data": {**meter_entity_values(state), "reading_status": "rebased"},
                    }
                    self.async_set_updated_data(self._retained)

        await asyncio.shield(self.hass.async_create_task(run(), f"{self.name} rebase"))
