"""Authenticated comparison settings, reference images and test captures."""

import re
from dataclasses import dataclass
from math import isfinite
from time import monotonic
from uuid import UUID, uuid4

import probatio
from aiohttp import web
from homeassistant.components.http import KEY_HASS, KEY_HASS_USER, HomeAssistantView
from homeassistant.core import HomeAssistant
from homeassistant.util.file import WriteError

from .analysis import async_analyze
from .comparison_store import ComparisonStore, GalleryImage, get_comparison_store
from .const import CONF_MODULE, DOMAIN
from .images import ImageError, ImageFrame

RESPONSE_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
_CAPTURE_SECONDS = 300
_CAPTURE_SLOTS = 4
_CACHE_KEY = f"{DOMAIN}.captures"
_HEX_ID = re.compile(r"[a-f0-9]{32}\Z")


def _id(value: str) -> str:
    if not _HEX_ID.fullmatch(value):
        raise probatio.Invalid("Invalid image or state ID")
    return value


def _upload_id(value: str) -> str:
    try:
        UUID(value)
    except ValueError as err:
        raise probatio.Invalid("Invalid upload ID") from err
    return value


def _title(value: str) -> str:
    value = value.strip()
    if not value or len(value) > 120 or value.casefold() == "unknown":
        raise probatio.Invalid("Invalid name")
    return value


def _number(maximum: float):
    def validate(value: int | float) -> float:
        if isinstance(value, bool) or not 0 <= value <= maximum or not isfinite(value):
            raise probatio.Invalid("Number outside range")
        return float(value)

    return probatio.All(probatio.Any(int, float), validate)


def _region(value: dict) -> dict:
    if (
        value["width"] <= 0
        or value["height"] <= 0
        or value["x"] + value["width"] > 1 + 1e-9
        or value["y"] + value["height"] > 1 + 1e-9
    ):
        raise probatio.Invalid("Region outside image")
    return value


ID = probatio.All(str, _id)
TITLE = probatio.All(str, _title)
REGION = probatio.All(
    probatio.Schema(
        {probatio.Required(key): _number(1) for key in ("x", "y", "width", "height")}
    ),
    _region,
)
SETTINGS = probatio.Schema(
    {
        probatio.Required("region"): probatio.Any(None, REGION),
        probatio.Required("max_distance"): _number(255),
        probatio.Required("min_margin"): _number(255),
    }
)
TEST = probatio.Schema(
    {probatio.Optional("reference_id"): ID, probatio.Optional("settings"): SETTINGS}
)
TARGET = {
    probatio.Required("state_id"): ID,
    probatio.Required("validation"): bool,
}
SCHEMAS = {
    "settings": SETTINGS,
    "state": probatio.Schema(
        {probatio.Optional("state_id"): ID, probatio.Required("name"): TITLE}
    ),
    "delete_state": probatio.Schema({probatio.Required("state_id"): ID}),
    "add": probatio.Schema(
        {
            **TARGET,
            probatio.Required("name"): TITLE,
            probatio.Optional("upload_id"): probatio.All(str, _upload_id),
            probatio.Optional("capture_id"): ID,
        }
    ),
    "move": probatio.Schema({**TARGET, probatio.Required("reference_id"): ID}),
    "delete": probatio.Schema({probatio.Required("reference_id"): ID}),
}


@dataclass(frozen=True)
class Capture:
    """Keep the exact tested frame temporarily for preview and classification."""

    profile_id: str
    user_id: str
    frame: ImageFrame
    expires_at: float


def _captures(hass: HomeAssistant) -> dict[str, Capture]:
    captures = hass.data.setdefault(_CACHE_KEY, {})
    now = monotonic()
    for key, capture in list(captures.items()):
        if capture.expires_at <= now:
            del captures[key]
    return captures


def drop_captures(hass: HomeAssistant, profile_id: str) -> None:
    """Forget captures belonging to a deleted analysis."""
    captures = _captures(hass)
    for key, capture in list(captures.items()):
        if capture.profile_id == profile_id:
            del captures[key]


def _capture_frame(
    request: web.Request, profile_id: str, capture_id: str
) -> ImageFrame | None:
    capture = _captures(request.app[KEY_HASS]).get(capture_id)
    if (
        capture
        and capture.profile_id == profile_id
        and capture.user_id == request[KEY_HASS_USER].id
    ):
        return capture.frame
    return None


def _store(request: web.Request, profile_id: str) -> ComparisonStore:
    if not request[KEY_HASS_USER].is_admin:
        raise web.HTTPForbidden
    hass = request.app[KEY_HASS]
    entry = hass.config_entries.async_get_entry(profile_id)
    if (
        entry is None
        or entry.domain != DOMAIN
        or entry.data[CONF_MODULE] != "comparison"
    ):
        raise web.HTTPNotFound
    return get_comparison_store(hass, profile_id)


class ComparisonView(HomeAssistantView):
    """List and edit a comparison gallery and test a capture or validation image."""

    url = f"/api/{DOMAIN}/comparison/{{profile_id}}"
    extra_urls = [f"/api/{DOMAIN}/comparison/{{profile_id}}/{{operation}}"]
    name = f"api:{DOMAIN}:comparison"

    async def get(
        self, request: web.Request, profile_id: str, operation: str | None = None
    ) -> web.Response:
        """Read saved comparison data."""
        store = _store(request, profile_id)
        if operation is not None:
            raise web.HTTPNotFound
        try:
            async with store.lock:
                data = await store.hass.async_add_executor_job(store.load)
        except ImageError as err:
            return self.json(
                {"reason": err.reason}, status_code=422, headers=RESPONSE_HEADERS
            )
        return self.json(data, headers=RESPONSE_HEADERS)

    async def post(
        self, request: web.Request, profile_id: str, operation: str | None = None
    ) -> web.Response:
        """Validate and execute a comparison request."""
        store = _store(request, profile_id)
        schema = TEST if operation == "test" else SCHEMAS.get(operation)
        if schema is None:
            raise web.HTTPNotFound
        try:
            values = schema(await request.json())
            if operation == "test":
                return await self._test(request, profile_id, values)
            frame = None
            if operation == "add":
                capture_id = values.get("capture_id")
                if ("upload_id" in values) == ("capture_id" in values):
                    raise probatio.Invalid("Specify one image source")
                if capture_id:
                    frame = _capture_frame(request, profile_id, capture_id)
                    if frame is None:
                        raise ImageError("capture_expired")
            data = await store.async_mutate(operation, values, frame)
        except (ValueError, probatio.Invalid):
            return self.json(
                {"reason": "invalid_request"}, status_code=400, headers=RESPONSE_HEADERS
            )
        except ImageError as err:
            return self.json(
                {"reason": err.reason}, status_code=422, headers=RESPONSE_HEADERS
            )
        except (OSError, WriteError):
            return self.json(
                {"reason": "storage_error"}, status_code=422, headers=RESPONSE_HEADERS
            )
        return self.json(data, headers=RESPONSE_HEADERS)

    async def _test(
        self, request: web.Request, profile_id: str, values: dict
    ) -> web.Response:
        hass = request.app[KEY_HASS]
        reference_id = values.get("reference_id")
        result = await async_analyze(
            hass,
            profile_id,
            reference_id=reference_id,
            settings_override=values.get("settings"),
        )
        image_id = reference_id if result.frame is not None else None
        if result.frame is not None and reference_id is None:
            image_id = uuid4().hex
            captures = _captures(hass)
            while len(captures) >= _CAPTURE_SLOTS:
                del captures[next(iter(captures))]
            captures[image_id] = Capture(
                profile_id,
                request[KEY_HASS_USER].id,
                result.frame,
                monotonic() + _CAPTURE_SECONDS,
            )
        return self.json(
            {**result.response, "image_id": image_id}, headers=RESPONSE_HEADERS
        )


class ComparisonImageView(HomeAssistantView):
    """Serve originals and thumbnails through an admin-only endpoint."""

    url = f"/api/{DOMAIN}/comparison/{{profile_id}}/image/{{image_id}}"
    name = f"api:{DOMAIN}:comparison:image"

    async def get(
        self, request: web.Request, profile_id: str, image_id: str
    ) -> web.Response:
        """Load a saved reference or the exact capture used by the preview."""
        store = _store(request, profile_id)
        frame = _capture_frame(request, profile_id, image_id)
        try:
            image = (
                GalleryImage(frame.content, frame.content_type)
                if frame is not None
                else await store.async_image(
                    image_id, request.query.get("thumbnail") == "1"
                )
            )
        except (OSError, ImageError):
            raise web.HTTPNotFound from None
        return web.Response(
            body=image.content,
            content_type=image.content_type,
            headers=RESPONSE_HEADERS,
        )
