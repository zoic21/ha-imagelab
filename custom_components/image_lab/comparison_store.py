"""Store comparison settings and originals privately in the HA configuration."""

import asyncio
import json
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from shutil import rmtree
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.util.file import WriteError, write_utf8_file_atomic
from PIL import Image, ImageOps

from .comparison import ComparisonData, Settings, compare
from .comparison_benchmark import run_benchmark
from .comparison_tarsius import async_ensure_tarsius, compare_tarsius
from .const import CONF_MODULE, DOMAIN
from .images import ImageError, ImageFrame, read_image_file, read_upload, validate_image
from .models import ModuleResult

STORAGE_VERSION = 1


@dataclass(frozen=True)
class GalleryImage:
    """An image returned by the gallery API."""

    content: bytes
    content_type: str


class ComparisonStore:
    """Own the settings and gallery for one stable config entry ID."""

    def __init__(self, hass: HomeAssistant, profile_id: str) -> None:
        """Keep gallery writes and runs ordered for this profile."""
        self.hass = hass
        self.profile_id = profile_id
        self.directory = Path(
            hass.config.path(".storage", f"{DOMAIN}.comparison", profile_id)
        )
        self.manifest = self.directory / "gallery.json"
        self.images = self.directory / "images"
        self.lock = asyncio.Lock()

    def load(self) -> ComparisonData:
        """Read the current gallery in the executor."""
        try:
            with self.manifest.open(encoding="utf-8") as file:
                stored = json.load(file)
        except FileNotFoundError:
            return {
                "settings": {
                    "engine": "pillow",
                    "region": None,
                    "max_distance": 25.0,
                    "min_margin": 3.0,
                },
                "states": [],
                "references": [],
            }
        except (ValueError, OSError) as err:
            raise ImageError("storage_error") from err
        if not isinstance(stored, dict) or stored.get("version") != STORAGE_VERSION:
            raise ImageError("storage_error")
        data = stored.get("data")
        if (
            not isinstance(data, dict)
            or not {"settings", "states", "references"} <= data.keys()
        ):
            raise ImageError("storage_error")
        settings = data["settings"]
        if not isinstance(settings, dict) or settings.setdefault(
            "engine", "pillow"
        ) not in ("pillow", "tarsius"):
            raise ImageError("storage_error")
        return data

    def _save(self, data: ComparisonData) -> None:
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        content = json.dumps(
            {"version": STORAGE_VERSION, "data": data}, ensure_ascii=False
        )
        write_utf8_file_atomic(str(self.manifest), content, private=True)

    def _apply(
        self, operation: str, values: dict, capture: ImageFrame | None
    ) -> ComparisonData:
        data = self.load()
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
        elif operation == "add":
            self._state(data, values["state_id"])
            frame = (
                capture
                if capture is not None
                else read_upload(self.hass, values["upload_id"])
            )
            reference_id = uuid4().hex
            self.images.mkdir(mode=0o700, parents=True, exist_ok=True)
            path = self.images / reference_id
            write_utf8_file_atomic(str(path), frame.content, private=True, mode="wb")
            data["references"].append(
                {
                    "id": reference_id,
                    "state_id": values["state_id"],
                    "name": values["name"],
                    "validation": values["validation"],
                }
            )
            try:
                self._save(data)
            except (OSError, WriteError):
                path.unlink(missing_ok=True)
                raise
            return data
        else:
            reference = self._reference(data, values["reference_id"])
            if operation == "move":
                self._state(data, values["state_id"])
                reference.update(
                    state_id=values["state_id"], validation=values["validation"]
                )
            else:
                data["references"].remove(reference)
                self._save(data)
                (self.images / reference["id"]).unlink(missing_ok=True)
                return data
        self._save(data)
        return data

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
                if entry is None or entry.data[CONF_MODULE] != "comparison":
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
        reference_id: str | None,
        gallery: ComparisonData,
    ) -> tuple[ModuleResult, ImageFrame]:
        expected = None
        if reference_id is not None:
            ref = self._reference(gallery, reference_id)
            if not ref["validation"]:
                raise ImageError("reference_not_validation")
            try:
                frame = validate_image(read_image_file(self.images / ref["id"]))
            except FileNotFoundError as err:
                raise ImageError("reference_not_found") from err
            expected = self._state(gallery, ref["state_id"])["name"]
        assert frame is not None
        engine = gallery["settings"]["engine"]
        process = compare_tarsius if engine == "tarsius" else compare
        result = process(frame, gallery, self.images)
        result.data["engine"] = engine
        if expected is not None:
            result.data["expected_state"] = expected
        return result, frame

    async def async_run(
        self,
        frame: ImageFrame | None,
        reference_id: str | None,
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
                    self._run, frame, reference_id, gallery
                )

        return await asyncio.shield(
            self.hass.async_create_task(run(), "image_lab comparison")
        )

    async def async_benchmark(self, settings: Settings | None) -> dict:
        """Evaluate one gallery snapshot without changing the saved settings."""

        await async_ensure_tarsius(self.hass)

        def run() -> dict:
            gallery = self.load()
            if settings is not None:
                gallery["settings"].update(settings)
            return run_benchmark(gallery, self.images)

        async def locked_run() -> dict:
            async with self.lock:
                return await self.hass.async_add_executor_job(run)

        return await asyncio.shield(
            self.hass.async_create_task(locked_run(), "image_lab comparison benchmark")
        )

    def _image(self, ref_id: str, thumbnail: bool) -> GalleryImage:
        ref = self._reference(self.load(), ref_id)
        try:
            frame = validate_image(read_image_file(self.images / ref["id"]))
        except FileNotFoundError as err:
            raise ImageError("reference_not_found") from err
        if not thumbnail:
            return GalleryImage(frame.content, frame.content_type)
        with Image.open(BytesIO(frame.content)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((200, 144))
            buffer = BytesIO()
            image.save(buffer, "JPEG", quality=80)
        return GalleryImage(buffer.getvalue(), "image/jpeg")

    async def async_image(self, ref_id: str, thumbnail: bool) -> GalleryImage:
        """Read a validated image or render a small thumbnail."""
        async with self.lock:
            return await self.hass.async_add_executor_job(
                self._image, ref_id, thumbnail
            )

    async def async_remove(self) -> None:
        """Delete comparison data when the owning profile is removed."""

        def remove() -> None:
            if self.directory.exists():
                rmtree(self.directory)

        async with self.lock:
            await self.hass.async_add_executor_job(remove)


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
