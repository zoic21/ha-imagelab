"""Fetch and store the original image used by an analysis."""

import asyncio
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import TypedDict
from uuid import UUID

from aiohttp import ClientError
from homeassistant.components.file_upload import process_uploaded_file
from homeassistant.const import STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util.file import write_utf8_file_atomic
from PIL import Image, ImageOps, features

from .const import DOMAIN, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, SourceType

_THUMBNAIL_SIZE = (240, 144)
_WEBP_MAX_DIMENSION = 16_383


class ImageError(HomeAssistantError):
    """An expected failure with a reason safe to show in the panel or an action."""

    def __init__(self, reason: str) -> None:
        """Initialize the error."""
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ImageFrame:
    """A still image with its encoded bytes and dimensions."""

    content: bytes
    content_type: str
    width: int
    height: int


Bounds = tuple[float, float, float, float]


class Region(TypedDict):
    """A rectangle relative to the oriented image dimensions."""

    x: float
    y: float
    width: float
    height: float


def crop_image(image: Image.Image, bounds: Bounds | None) -> Image.Image:
    """Orient an opened image in place, then crop it if bounds are set."""
    ImageOps.exif_transpose(image, in_place=True)
    if bounds is None:
        return image

    left, top, span_x, span_y = bounds
    width, height = image.size
    x = min(width - 1, round(left * width))
    y = min(height - 1, round(top * height))
    right = max(x + 1, round((left + span_x) * width))
    bottom = max(y + 1, round((top + span_y) * height))
    return image.crop((x, y, min(right, width), min(bottom, height)))


@contextmanager
def analysis_pixels(
    frame: ImageFrame, region: Region | None
) -> Iterator[tuple[Image.Image, ImageFrame]]:
    """Give the processor decoded pixels and preserve the exact frame for history."""
    with Image.open(BytesIO(frame.content)) as source:
        if region is None:
            yield source, frame
            return
        bounds = (region["x"], region["y"], region["width"], region["height"])
        cropped = crop_image(source, bounds)
    if cropped.mode not in ("RGB", "RGBA", "L"):
        cropped = cropped.convert("RGBA")
    with cropped:
        yield cropped, _encode_crop(cropped)


def _encode_crop(cropped: Image.Image) -> ImageFrame:
    """Encode the oriented pixels before a processor resizes them in place."""
    with BytesIO() as buffer:
        if (
            cropped.mode in ("RGB", "RGBA")
            and "transparency" not in cropped.info
            and max(cropped.size) <= _WEBP_MAX_DIMENSION
            and features.check("webp")
        ):
            # With lossless WebP, quality controls compression effort. exact
            # also preserves the RGB channels of completely transparent pixels.
            cropped.save(
                buffer, "WEBP", lossless=True, quality=0, method=0, exact=True,
                icc_profile=cropped.info.get("icc_profile"),
            )
            content_type = "image/webp"
        else:
            cropped.save(buffer, "PNG", compress_level=1)
            content_type = "image/png"
        return ImageFrame(buffer.getvalue(), content_type, *cropped.size)


def thumbnail_frame(frame: ImageFrame) -> ImageFrame:
    """Render a small, oriented image for lists and galleries."""
    return _thumbnail(BytesIO(frame.content))


def _thumbnail(source: Path | BytesIO) -> ImageFrame:
    with open_validated_image(source, thumbnail=True) as image:
        ImageOps.exif_transpose(image, in_place=True)
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.thumbnail(_THUMBNAIL_SIZE)
        buffer = BytesIO()
        image.save(buffer, "JPEG", quality=80)
        return ImageFrame(buffer.getvalue(), "image/jpeg", *image.size)


@contextmanager
def open_validated_image(
    content: bytes | Path | BytesIO, *, thumbnail: bool = False, decode: bool = True
) -> Iterator[Image.Image]:
    """Check input bounds and format, optionally deferring the pixel decode."""
    # Source byte limits do not apply to previews encoded from validated pixels.
    if isinstance(content, bytes):
        if not content:
            raise ImageError("invalid_image")
        if len(content) > MAX_IMAGE_BYTES:
            raise ImageError("image_too_large")

    with ExitStack() as stack:
        try:
            source = BytesIO(content) if isinstance(content, bytes) else content
            image = stack.enter_context(Image.open(source, formats=list(IMAGE_TYPES)))
            width, height = image.size
            if width * height > MAX_IMAGE_PIXELS:
                raise ImageError("image_too_large")
            if getattr(image, "is_animated", False):
                raise ImageError("invalid_image")
            if thumbnail and image.format == "JPEG":
                # Let Pillow request a reduced JPEG decode before EXIF rotation loads pixels.
                bounds = _THUMBNAIL_SIZE
                if image.getexif().get(Image.ExifTags.Base.Orientation) in (5, 6, 7, 8):
                    bounds = bounds[::-1]
                image.thumbnail(bounds, reducing_gap=1.0)
            if decode:
                image.load()
        except Image.DecompressionBombError as err:
            raise ImageError("image_too_large") from err
        except (OSError, SyntaxError, ValueError) as err:
            raise ImageError("invalid_image") from err
        yield image


def _read_frame(content: bytes, decode: bool) -> ImageFrame:
    with open_validated_image(content, decode=decode) as image:
        return ImageFrame(content, IMAGE_TYPES[image.format], *image.size)


def validate_image(content: bytes) -> ImageFrame:
    """Fully decode an original before accepting it for storage or display."""
    return _read_frame(content, True)


def read_image_file(path: Path) -> bytes:
    with path.open("rb") as file:
        return file.read(MAX_IMAGE_BYTES + 1)


def read_thumbnail(path: Path) -> ImageFrame:
    """Reuse a thumbnail while its original file is unchanged."""
    stat = path.stat()
    revision = (stat.st_ino, stat.st_ctime_ns, stat.st_mtime_ns, stat.st_size)
    return _read_thumbnail(path, revision)


@lru_cache(maxsize=256)
def _read_thumbnail(path: Path, _revision: tuple[int, int, int, int]) -> ImageFrame:
    return _thumbnail(path)


def read_upload(hass: HomeAssistant, upload_id: str) -> ImageFrame:
    """Consume a native Home Assistant upload and validate its original bytes."""
    try:
        with process_uploaded_file(hass, upload_id) as path:
            return validate_image(read_image_file(path))
    except (KeyError, ValueError, OSError) as err:
        raise ImageError("invalid_image") from err


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
        frame = read_upload(self.hass, upload_id)
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
                read_image_file, self._path(image_key)
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
    *,
    for_analysis: bool = False,
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

    return await hass.async_add_executor_job(_read_frame, content, not for_analysis)
