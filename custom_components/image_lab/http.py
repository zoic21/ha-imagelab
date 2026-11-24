"""Shared access checks and response headers for Image Lab HTTP views."""

from aiohttp import web
from homeassistant.components.http import KEY_HASS, KEY_HASS_USER
from homeassistant.config_entries import ConfigEntry

from .const import CONF_MODULE, DOMAIN

RESPONSE_HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def admin_profile(request: web.Request, profile_id: str, *, module: str | None = None) -> ConfigEntry:
    """Require an admin before looking up a profile and checking its module."""
    if not request[KEY_HASS_USER].is_admin:
        raise web.HTTPForbidden
    entry = request.app[KEY_HASS].config_entries.async_get_entry(profile_id)
    if entry is None or entry.domain != DOMAIN or CONF_MODULE not in entry.data:
        raise web.HTTPNotFound
    if module is not None and entry.data[CONF_MODULE] != module:
        raise web.HTTPNotFound
    return entry
