"""Constants for Image Lab."""

from enum import StrEnum

DOMAIN = "image_lab"
PANEL_PATH = "image-lab"
SERVICE_ANALYZE = "analyze"
CONF_MODULE = "module"
CONF_SOURCE_TYPE = "source_type"
CONF_PROFILE_ID = "profile_id"
CONF_IMAGE_KEY = "image_key"
CONF_FILE = "file"

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
IMAGE_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


class SourceType(StrEnum):
    """Sources supported by Image Lab."""

    CAMERA = "camera"
    MEDIA_PLAYER = "media_player"
    UPLOAD = "upload"
