"""Store comparison settings and originals privately in the HA configuration."""

import asyncio
from filecmp import cmp as same_file_content
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.util.file import write_utf8_file_atomic

from .comparison import ComparisonData, Settings, compare
from .comparison_tarsius import async_ensure_tarsius, compare_tarsius
from .const import CONF_MODULE, DOMAIN
from .images import (
    ImageError, ImageFrame, read_image_file, read_thumbnail, read_upload, validate_image,
)
from .models import ModuleResult
from .result_store import DEFAULT_HISTORY, Observation, ResultStore

DEFAULT_COMPARISON_HISTORY = {**DEFAULT_HISTORY, "mode": "changes"}


class ComparisonStore(ResultStore):
    """Own the settings and gallery for one stable config entry ID."""

    def __init__(self, hass: HomeAssistant, profile_id: str) -> None:
        """Keep gallery writes and runs ordered for this profile."""
        super().__init__(hass, profile_id, "comparison", "gallery.json")

    def load(self) -> ComparisonData:
        """Read the current gallery in the executor."""
        data = self._load()
        if data is None:
            return {
                "settings": {
                    "engine": "pillow",
                    "region": None,
                    "max_distance": 25.0,
                    "min_margin": 3.0,
                },
                "history_settings": DEFAULT_COMPARISON_HISTORY.copy(),
                "history": [],
                "states": [],
                "references": [],
            }
        if not {"settings", "states", "references"} <= data.keys():
            raise ImageError("storage_error")
        settings = data["settings"]
        if not isinstance(settings, dict) or settings.setdefault(
            "engine", "pillow"
        ) not in ("pillow", "tarsius"):
            raise ImageError("storage_error")
        data.setdefault("history_settings", DEFAULT_COMPARISON_HISTORY.copy())
        data.setdefault("history", [])
        for reference in data["references"]:
            reference.pop("validation", None)
        return data

    def load_with_latest(self) -> tuple[ComparisonData, Observation | ImageError | None]:
        """Read the gallery and latest observation from the same snapshot."""
        data = self.load()
        try:
            return data, self._latest(data)
        except ImageError as err:
            # A missing legacy capture should not prevent editing the gallery.
            return data, err

    def _apply(
        self, operation: str, values: dict, capture: ImageFrame | None
    ) -> ComparisonData:
        data = self.load()
        if operation == "history_settings":
            self._set_history_settings(data, values)
            return data
        if operation in ("add", "correct"):
            return self._assign_reference(data, values, capture)
        if operation == "settings":
            data["settings"].update(values)
        elif operation == "state":
            state_id = values.get("state_id")
            name = values["name"]
            for state in data["states"]:
                if (
                    state["id"] != state_id
                    and state["name"].casefold() == name.casefold()
                ):
                    raise ImageError("duplicate_state")
            if state_id is None:
                data["states"].append({"id": uuid4().hex, "name": name})
            else:
                self._state(data, state_id)["name"] = name
        elif operation == "delete_state":
            state = self._state(data, values["state_id"])
            if any(ref["state_id"] == state["id"] for ref in data["references"]):
                raise ImageError("state_not_empty")
            data["states"].remove(state)
        else:
            reference = self._reference(data, values["reference_id"])
            if operation == "move":
                self._state(data, values["state_id"])
                reference["state_id"] = values["state_id"]
            else:
                data["references"].remove(reference)
                self._save(data)
                image_id = reference["id"]
                if data.get("latest", {}).get("id") != image_id and not any(
                    item["id"] == image_id for item in data["history"]
                ):
                    (self.images / image_id).unlink(missing_ok=True)
                return data
        self._save(data)
        return data

    def _assign_reference(
        self, data: ComparisonData, values: dict, capture: ImageFrame | None
    ) -> ComparisonData:
        state = self._state(data, values["state_id"])
        capture_id = values.get("capture_id")
        name = values.get("name")
        references = data["references"]
        reference = next((r for r in references if r["id"] == capture_id), None)
        obsolete = []
        if capture_id and capture is None:
            latest = data.get("latest")
            history = {item["id"]: item for item in data["history"]}
            if latest:
                history[latest["id"]] = latest
            item = history.get(capture_id)
            if item is None and reference is None:
                raise ImageError("capture_expired")
            path = self.images / capture_id
            if not path.is_file():
                raise ImageError("capture_expired")
            # Older panels copied a capture under a fresh ID and a dated display name.
            # Only reconcile that name when the bytes match as well. Keep distinct captures.
            if name:
                for ref in references:
                    if (
                        "source" in ref or ref["name"] != name
                        or ref["id"] in history or ref["id"] == capture_id
                    ):
                        continue
                    other = self.images / ref["id"]
                    if other.is_file() and same_file_content(path, other, shallow=False):
                        obsolete.append(ref)
            if item:
                name = name or item["time"]
        elif not capture_id:
            capture = read_upload(self.hass, values["upload_id"])

        if reference is not None:
            reference["state_id"] = state["id"]
            reference["source"] = "capture"
            capture = None  # A retry can still carry the temporary preview frame.
        else:
            reference_id = capture_id or uuid4().hex
            reference = {
                "id": reference_id, "state_id": state["id"], "name": name,
                "source": "capture" if capture_id else "upload",
            }
            references.append(reference)
        latest_result = data["latest"]["response"]["data"] if data.get("latest") else {}
        for old in obsolete:
            references.remove(old)
            if latest_result.get("reference_id") == old["id"]:
                latest_result["reference_id"] = reference["id"]

        path = self.images / reference["id"]
        if capture is not None:
            self.images.mkdir(mode=0o700, parents=True, exist_ok=True)
            write_utf8_file_atomic(str(path), capture.content, private=True, mode="wb")
        self._save_history(
            data, path if capture is not None else None, obsolete=tuple(r["id"] for r in obsolete)
        )
        return data

    @staticmethod
    def _history_item(data: ComparisonData, image_id: str):
        for item in data["history"]:
            if item["id"] == image_id:
                return item
        raise ImageError("capture_expired")

    def _append_history(self, data: dict, observation: Observation) -> None:
        mode = data["history_settings"]["mode"]
        history = data["history"]
        response = observation["response"]
        result = response["data"]
        state_id = result.get("state_id")
        if not observation["manual"] and (
            mode == "off" or (
                mode == "changes" and state_id and history
                and history[-1]["state_id"] == state_id
            )
        ):
            return
        history.append({
            "id": observation["id"], "time": observation["time"],
            "manual": observation["manual"], "state_id": state_id,
            "state": result.get("state"), "reason": response.get("reason"),
            "engine": result["engine"],
        })

    def _latest(self, data: dict) -> Observation | None:
        if data.get("latest") or not data["history"]:
            return super()._latest(data)
        # Entries recorded before previews were persisted only have the state and engine.
        item = data["history"][-1]
        frame = self._frame(item["id"])
        return {
            "id": item["id"], "time": item["time"], "manual": False,
            "content_type": frame.content_type, "width": frame.width, "height": frame.height,
            "response": {
                "status": "ok" if item["state_id"] else "unknown", "reason": item.get("reason"),
                "data": {key: item[key] for key in ("engine", "state", "state_id")},
            },
        }

    @staticmethod
    def _state(data: ComparisonData, state_id: str):
        for state in data["states"]:
            if state["id"] == state_id:
                return state
        raise ImageError("state_not_found")

    @staticmethod
    def _reference(data: ComparisonData, reference_id: str):
        for reference in data["references"]:
            if reference["id"] == reference_id:
                return reference
        raise ImageError("reference_not_found")

    async def async_mutate(
        self, operation: str, values: dict, capture: ImageFrame | None = None
    ) -> ComparisonData:
        """Apply one mutation after verifying the profile is still configured."""

        async def apply() -> ComparisonData:
            async with self.lock:
                entry = self.hass.config_entries.async_get_entry(self.profile_id)
                if entry is None or entry.data.get(CONF_MODULE) != "comparison":
                    raise ImageError("profile_not_found")
                return await self.hass.async_add_executor_job(
                    self._apply, operation, values, capture
                )

        # A disconnected client cannot cancel filesystem work already in the executor.
        return await asyncio.shield(
            self.hass.async_create_task(apply(), "image_lab gallery update")
        )

    def _run(
        self,
        frame: ImageFrame | None,
        gallery: ComparisonData,
    ) -> tuple[ModuleResult, ImageFrame]:
        assert frame is not None
        engine = gallery["settings"]["engine"]
        process = compare_tarsius if engine == "tarsius" else compare
        result = process(frame, gallery, self.images)
        result.data["engine"] = engine
        result.data["region"] = gallery["settings"]["region"]
        return result, frame

    async def async_run(
        self,
        frame: ImageFrame | None,
        settings: Settings | None,
    ) -> tuple[ModuleResult, ImageFrame]:
        """Run against a consistent gallery while keeping I/O off the event loop."""

        async def run() -> tuple[ModuleResult, ImageFrame]:
            async with self.lock:
                gallery = await self.hass.async_add_executor_job(self.load)
                if settings is not None:
                    gallery["settings"].update(settings)
                if gallery["settings"]["engine"] == "tarsius":
                    await async_ensure_tarsius(self.hass)
                return await self.hass.async_add_executor_job(
                    self._run, frame, gallery
                )

        return await asyncio.shield(
            self.hass.async_create_task(run(), "image_lab comparison")
        )

    def _frame(self, image_id: str) -> ImageFrame:
        try:
            return validate_image(read_image_file(self.images / image_id))
        except FileNotFoundError as err:
            raise ImageError("reference_not_found") from err

    def _image(self, ref_id: str, thumbnail: bool) -> ImageFrame:
        data = self.load()
        if ref_id != data.get("latest", {}).get("id") and not any(
            ref["id"] == ref_id for ref in data["references"]
        ):
            self._history_item(data, ref_id)
        return read_thumbnail(self.images / ref_id) if thumbnail else self._frame(ref_id)

    async def async_image(self, ref_id: str, thumbnail: bool) -> ImageFrame:
        """Read a validated image or render a small thumbnail."""
        async with self.lock:
            return await self.hass.async_add_executor_job(
                self._image, ref_id, thumbnail
            )


def get_comparison_store(hass: HomeAssistant, profile_id: str) -> ComparisonStore:
    """Return the store shared by the action, panel and lifecycle handlers."""
    stores = hass.data.setdefault(f"{DOMAIN}.comparison", {})
    if profile_id not in stores:
        stores[profile_id] = ComparisonStore(hass, profile_id)
    return stores[profile_id]


async def async_remove_comparison(hass: HomeAssistant, profile_id: str) -> None:
    """Release one profile's gallery and runtime store."""
    await get_comparison_store(hass, profile_id).async_remove()
    hass.data[f"{DOMAIN}.comparison"].pop(profile_id, None)
