"""Authenticated comparison settings, reference images and test captures."""

import re
from dataclasses import dataclass
from math import isfinite
from time import monotonic
from typing import ClassVar
from uuid import UUID, uuid4

import probatio
from aiohttp import web
from homeassistant.components.http import KEY_HASS, KEY_HASS_USER, HomeAssistantView
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.util.file import WriteError

from .analysis import async_analyze
from .comparison_store import ComparisonStore, get_comparison_store
from .const import CONF_MODULE, DOMAIN
from .images import ImageError, ImageFrame, thumbnail_frame
from .result_store import Observation

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
    def validate(value: float) -> float:
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
        probatio.Optional("engine"): probatio.In(("pillow", "tarsius")),
        probatio.Required("region"): probatio.Any(None, REGION),
        probatio.Required("max_distance"): _number(255),
        probatio.Required("min_margin"): _number(255),
    }
)
TEST = probatio.Schema(
    {probatio.Optional("settings"): SETTINGS}
)
TARGET = {
    probatio.Required("state_id"): ID,
}


def _history_limit(n: int) -> int:
    if type(n) is not int or not 1 <= n <= 100:
        raise probatio.Invalid("History limit must be an integer from 1 to 100")
    return n


HISTORY_SETTINGS = probatio.Schema(
    {
        probatio.Required("mode"): probatio.In(("off", "all", "changes")),
        probatio.Required("limit"): _history_limit,
    }
)

SCHEMAS = {
    "correct": probatio.Schema({**TARGET, probatio.Required("capture_id"): ID}),
    "history_settings": HISTORY_SETTINGS,
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
        or entry.data.get(CONF_MODULE) != "comparison"
    ):
        raise web.HTTPNotFound
    return get_comparison_store(hass, profile_id)


class ComparisonView(HomeAssistantView):
    """List and edit a comparison gallery and test a capture."""

    url = f"/api/{DOMAIN}/comparison/{{profile_id}}"
    extra_urls: ClassVar[list[str]] = [f"/api/{DOMAIN}/comparison/{{profile_id}}/{{operation}}"]
    name = f"api:{DOMAIN}:comparison"

    async def get(
        self, request: web.Request, profile_id: str, operation: str | None = None
    ) -> web.Response:
        """Read saved comparison data."""
        store = _store(request, profile_id)
        try:
            if operation == "latest":
                latest = await store.async_latest()
                return self.json(
                    _preview_response(latest) if latest is not None else None,
                    headers=RESPONSE_HEADERS,
                )
            if operation is not None:
                raise web.HTTPNotFound
            if request.query.get("include_latest") == "1":
                async with store.lock:
                    data, latest = await store.hass.async_add_executor_job(
                        store.load_with_latest
                    )
                response: dict[str, object] = {
                    "gallery": _gallery_response(data), "latest": None,
                }
                if isinstance(latest, ImageError):
                    response["latest_error"] = latest.reason
                elif latest is not None:
                    response["latest"] = _preview_response(latest)
                return self.json(response, headers=RESPONSE_HEADERS)
            async with store.lock:
                data = await store.hass.async_add_executor_job(store.load)
        except ImageError as err:
            return self.json(
                {"reason": err.reason}, status_code=422, headers=RESPONSE_HEADERS
            )
        return self.json(_gallery_response(data), headers=RESPONSE_HEADERS)

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
        return self.json(_gallery_response(data), headers=RESPONSE_HEADERS)

    async def _test(
        self, request: web.Request, profile_id: str, values: dict
    ) -> web.Response:
        hass = request.app[KEY_HASS]
        entry = hass.config_entries.async_get_entry(profile_id)
        if (
            "settings" not in values and entry is not None
            and entry.state is ConfigEntryState.LOADED and entry.runtime_data
        ):
            result, observation = await entry.runtime_data.async_run_manual()
            if result.frame is not None and observation is None:
                raise ImageError("storage_error")
            return self.json(
                _preview_response(observation) if observation is not None else {
                    **result.response, "image_id": None,
                },
                headers=RESPONSE_HEADERS,
            )
        result = await async_analyze(
            hass,
            profile_id,
            settings_override=values.get("settings"),
        )
        image_id = None
        if result.frame is not None:
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


def _gallery_response(data: dict) -> dict:
    return {key: value for key, value in data.items() if key != "latest"}


def _preview_response(observation: Observation) -> dict:
    return {
        **observation["response"],
        "image_id": observation["id"],
        "time": observation["time"],
        "manual": observation["manual"],
    }


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
        thumbnail = request.query.get("thumbnail") == "1"
        try:
            if frame is None:
                image = await store.async_image(image_id, thumbnail)
            elif thumbnail:
                image = await store.hass.async_add_executor_job(thumbnail_frame, frame)
            else:
                image = frame
        except (OSError, ImageError):
            raise web.HTTPNotFound from None
        return web.Response(
            body=image.content,
            content_type=image.content_type,
            headers=RESPONSE_HEADERS,
        )
