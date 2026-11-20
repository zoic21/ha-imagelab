"""Fetch and store the original image used by an analysis."""

import asyncio
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from uuid import UUID

from aiohttp import ClientError
from homeassistant.components.file_upload import process_uploaded_file
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util.file import write_utf8_file_atomic
from PIL import Image

from .const import DOMAIN, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, SourceType


class ImageError(HomeAssistantError):
    """An expected failure with a reason safe to show in the panel or an action."""

    def __init__(self, reason: str) -> None:
        """Initialize the error."""
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ImageFrame:
    """A validated still image with its original bytes."""

    content: bytes
    content_type: str
    width: int
    height: int


def validate_image(content: bytes) -> ImageFrame:
    """Check the format and size and decode the image off the event loop."""
    if not content:
        raise ImageError("invalid_image")
    if len(content) > MAX_IMAGE_BYTES:
        raise ImageError("image_too_large")

    try:
        with Image.open(BytesIO(content), formats=list(IMAGE_TYPES)) as image:
            width, height = image.size
            if width * height > MAX_IMAGE_PIXELS:
                raise ImageError("image_too_large")
            if getattr(image, "is_animated", False):
                raise ImageError("invalid_image")
            content_type = IMAGE_TYPES[image.format]
            image.load()
    except Image.DecompressionBombError as err:
        raise ImageError("image_too_large") from err
    except (OSError, SyntaxError, ValueError) as err:
        raise ImageError("invalid_image") from err

    return ImageFrame(content, content_type, width, height)


def _read_image_file(path: Path) -> bytes:
    with path.open("rb") as file:
        return file.read(MAX_IMAGE_BYTES + 1)


class ImageStorage:
    """Keep one private, atomically replaced original per analysis."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize storage in the Home Assistant configuration backup."""
        self.hass = hass
        self.directory = Path(hass.config.path(".storage", f"{DOMAIN}.images"))
        self._write_lock = asyncio.Lock()

    def _path(self, image_key: str) -> Path:
        return self.directory / UUID(image_key).hex

    def _import_file(self, image_key: str, upload_id: str) -> None:
        try:
            with process_uploaded_file(self.hass, upload_id) as path:
                frame = validate_image(_read_image_file(path))
        except (ValueError, OSError) as err:
            raise ImageError("invalid_image") from err

        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        write_utf8_file_atomic(str(self._path(image_key)), frame.content, True, "wb")

    async def async_import(
        self, image_key: str, upload_id: str, entry_id: str | None
    ) -> None:
        """Validate a native upload and persist the original for this profile."""
        async with self._write_lock:
            if entry_id and self.hass.config_entries.async_get_entry(entry_id) is None:
                raise ImageError("profile_not_found")
            await self.hass.async_add_executor_job(
                self._import_file, image_key, upload_id
            )

    async def async_read(self, image_key: str) -> bytes:
        """Read the last successfully imported image."""
        try:
            return await self.hass.async_add_executor_job(
                _read_image_file, self._path(image_key)
            )
        except FileNotFoundError as err:
            raise ImageError("image_missing") from err

    async def async_remove(self, image_key: str) -> None:
        """Remove the original when the owning config entry is deleted."""
        async with self._write_lock:
            await self.hass.async_add_executor_job(self._path(image_key).unlink, True)


def get_image_storage(hass: HomeAssistant) -> ImageStorage:
    """Return the same storage instance for config flows and the runner."""
    key = f"{DOMAIN}.images"
    if key not in hass.data:
        hass.data[key] = ImageStorage(hass)
    return hass.data[key]


async def async_get_frame(
    hass: HomeAssistant,
    source: SourceType,
    entity_id: str | None,
    image_key: str,
) -> ImageFrame:
    """Acquire an image through the selected Home Assistant source."""
    if source is SourceType.UPLOAD:
        content = await get_image_storage(hass).async_read(image_key)
    else:
        state = hass.states.get(entity_id) if entity_id else None
        if (
            state is None
            or state.state == STATE_UNAVAILABLE
            or source not in hass.config.components
        ):
            raise ImageError("source_unavailable")
        try:
            if source is SourceType.CAMERA:
                from homeassistant.components.camera import async_get_image

                content = (await async_get_image(hass, entity_id)).content
            else:
                from homeassistant.components.media_player import MediaPlayerEntity
                from homeassistant.components.media_player.const import DATA_COMPONENT

                players = hass.data.get(DATA_COMPONENT)
                player = players.get_entity(entity_id) if players else None
                if not isinstance(player, MediaPlayerEntity):
                    raise ImageError("source_unavailable")
                async with asyncio.timeout(10):
                    content, _ = await player.async_get_media_image()
        except ImageError:
            raise
        except (ClientError, HomeAssistantError, OSError, TimeoutError) as err:
            raise ImageError("source_unavailable") from err
        if not content:
            raise ImageError("source_no_image")

    return await hass.async_add_executor_job(validate_image, content)
