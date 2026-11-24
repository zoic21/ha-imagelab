"""Keep the exact frame and result of recent analyses in private storage."""

import asyncio
import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from shutil import rmtree
from typing import TypedDict
from uuid import uuid4

from homeassistant.core import HomeAssistant, ServiceResponse
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util.file import WriteError, write_utf8_file_atomic

from .const import DOMAIN
from .images import ImageError, ImageFrame, read_thumbnail

STORAGE_VERSION = 1
DEFAULT_HISTORY = {"mode": "all", "limit": 10}
SIGNAL_CAPTURE_SAVED = f"{DOMAIN}_capture_saved"
_LOGGER = logging.getLogger(__name__)


class Observation(TypedDict):
    id: str
    time: str
    manual: bool
    response: ServiceResponse
    content_type: str
    width: int
    height: int


def observation_response(observation: Observation) -> dict:
    """Return the analysis metadata keyed to the exact saved image."""
    return {
        **observation["response"],
        "image_id": observation["id"],
        "time": observation["time"],
        "manual": observation["manual"],
    }


class ResultStore:
    """Keep a latest observation independently of the bounded history."""

    def __init__(
        self, hass: HomeAssistant, profile_id: str, storage: str = "results",
        filename: str = "results.json",
    ) -> None:
        self.hass = hass
        self.profile_id = profile_id
        self.directory = Path(hass.config.path(".storage", f"{DOMAIN}.{storage}", profile_id))
        self.manifest = self.directory / filename
        self.images = self.directory / "images"
        self.lock = asyncio.Lock()

    def _load(self) -> dict | None:
        try:
            with self.manifest.open(encoding="utf-8") as file:
                stored = json.load(file)
        except FileNotFoundError:
            return None
        except (ValueError, OSError) as err:
            raise ImageError("storage_error") from err
        if (
            not isinstance(stored, dict)
            or stored.get("version") != STORAGE_VERSION
            or not isinstance(stored.get("data"), dict)
        ):
            raise ImageError("storage_error")
        return stored["data"]

    def load(self) -> dict:
        return self._load() or {"history": []}

    def _save(self, data: dict) -> None:
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        content = json.dumps({"version": STORAGE_VERSION, "data": data}, ensure_ascii=False)
        write_utf8_file_atomic(str(self.manifest), content, private=True)

    def _save_history(
        self, data: dict, new_image: Path | None = None, *, obsolete: tuple[str, ...] = (),
    ) -> None:
        limit = data.get("history_settings", DEFAULT_HISTORY)["limit"]
        expired = {item["id"] for item in data["history"][:-limit]}
        del data["history"][:-limit]
        expired.update(obsolete)
        try:
            self._save(data)
        except (OSError, WriteError):
            if new_image is not None:
                new_image.unlink(missing_ok=True)
            raise
        kept = {item["id"] for item in data["history"] + data.get("references", [])}
        if latest := data.get("latest"):
            kept.add(latest["id"])
        for image_id in expired - kept:
            try:
                (self.images / image_id).unlink(missing_ok=True)
            except OSError:
                _LOGGER.exception("Could not remove expired image for %s", self.profile_id)

    def _append_history(self, data: dict, observation: Observation) -> None:
        if observation["manual"] or data.get("history_settings", DEFAULT_HISTORY)["mode"] != "off":
            data["history"].append(observation)

    def _set_history_settings(self, data: dict, settings: dict) -> None:
        data["history_settings"] = settings
        self._save_history(data)

    async def async_history_settings(self) -> dict:
        async with self.lock:
            return await self.hass.async_add_executor_job(
                lambda: self.load().get("history_settings", DEFAULT_HISTORY)
            )

    async def async_set_history_settings(self, settings: dict) -> None:
        def save() -> None:
            self._set_history_settings(self.load(), settings)

        async def run() -> None:
            async with self.lock:
                if self.hass.config_entries.async_get_entry(self.profile_id) is None:
                    raise ImageError("profile_not_found")
                await self.hass.async_add_executor_job(save)

        await asyncio.shield(self.hass.async_create_task(run(), "image_lab history settings"))

    def _record(
        self, frame: ImageFrame, response: ServiceResponse, manual: bool,
        meter_state: dict | None = None,
    ) -> Observation:
        data = self.load()
        previous = data.get("latest")
        observation: Observation = {
            "id": uuid4().hex,
            "time": datetime.now(UTC).isoformat(),
            "manual": manual,
            "response": response,
            "content_type": frame.content_type,
            "width": frame.width,
            "height": frame.height,
        }
        self.images.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = self.images / observation["id"]
        write_utf8_file_atomic(str(path), frame.content, private=True, mode="wb")
        data["latest"] = observation
        if meter_state is not None:
            data["meter_state"] = meter_state
        self._append_history(data, observation)
        self._save_history(data, path, obsolete=(previous["id"],) if previous else ())
        return observation

    async def async_record(
        self, frame: ImageFrame, response: ServiceResponse, manual: bool,
        meter_state: dict | None = None,
    ) -> Observation:
        async with self.lock:
            observation = await self.hass.async_add_executor_job(
                self._record, frame, response, manual, meter_state
            )
            async_dispatcher_send(self.hass, SIGNAL_CAPTURE_SAVED, self.profile_id, observation["id"])
            return observation

    async def async_meter_state(self) -> dict | None:
        async with self.lock:
            return await self.hass.async_add_executor_job(lambda: self.load().get("meter_state"))

    async def async_set_meter_state(self, state: dict) -> None:
        """Persist a confirmed index while keeping the saved observations."""
        def save() -> None:
            self._save({**self.load(), "meter_state": state})

        async with self.lock:
            if self.hass.config_entries.async_get_entry(self.profile_id) is None:
                raise ImageError("profile_not_found")
            await self.hass.async_add_executor_job(save)

    def _latest(self, data: dict) -> Observation | None:
        return data.get("latest")

    async def async_latest(self) -> Observation | None:
        async with self.lock:
            return await self.hass.async_add_executor_job(lambda: self._latest(self.load()))

    async def async_history(self) -> list[dict]:
        async with self.lock:
            return await self.hass.async_add_executor_job(
                lambda: [
                    {
                        "id": item["id"], "time": item["time"], "manual": item["manual"],
                        "dominant_hex": item["response"]["data"].get("dominant_hex"),
                        "count": item["response"]["data"].get("count"),
                        **(
                            {"meter": item["response"]["data"], "reason": item["response"].get("reason")}
                            if item["response"].get("module") == "meter"
                            else {}
                        ),
                    }
                    for item in reversed(self.load()["history"])
                ]
            )

    def _observation(self, image_id: str | None, *, include_latest: bool = False) -> Observation | None:
        data = self.load()
        if image_id is None:
            return self._latest(data)
        if include_latest and (latest := self._latest(data)) and latest["id"] == image_id:
            return latest
        return next((item for item in data["history"] if item["id"] == image_id), None)

    async def async_observation(self, image_id: str) -> Observation | None:
        """Read metadata for a capture without loading its image."""
        async with self.lock:
            return await self.hass.async_add_executor_job(lambda: self._observation(image_id, include_latest=True))

    def _read(self, image_id: str | None, thumbnail: bool = False) -> tuple[Observation, ImageFrame] | None:
        observation = self._observation(image_id)
        if observation is None:
            return None
        path = self.images / observation["id"]
        try:
            if thumbnail:
                return observation, read_thumbnail(path)
            content = path.read_bytes()
        except OSError as err:
            raise ImageError("storage_error") from err
        frame = ImageFrame(
            content, observation["content_type"], observation["width"], observation["height"]
        )
        return observation, frame

    async def async_read(self, image_id: str | None, thumbnail: bool = False) -> tuple[Observation, ImageFrame] | None:
        async with self.lock:
            return await self.hass.async_add_executor_job(self._read, image_id, thumbnail)

    async def async_remove(self) -> None:
        async with self.lock:
            try:
                await self.hass.async_add_executor_job(rmtree, self.directory)
            except FileNotFoundError:
                pass


def get_result_store(hass: HomeAssistant, profile_id: str) -> ResultStore:
    stores = hass.data.setdefault(f"{DOMAIN}.results", {})
    if profile_id not in stores:
        stores[profile_id] = ResultStore(hass, profile_id)
    return stores[profile_id]


async def async_remove_results(hass: HomeAssistant, profile_id: str) -> None:
    await get_result_store(hass, profile_id).async_remove()
    hass.data[f"{DOMAIN}.results"].pop(profile_id, None)
