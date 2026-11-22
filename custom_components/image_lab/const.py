"""Constants for Image Lab."""

from enum import StrEnum

DOMAIN = "image_lab"
PANEL_PATH = "image-lab"
SERVICE_ANALYZE = "analyze"
CONF_MODULE = "module"
CONF_SOURCE_TYPE = "source_type"
CONF_PROFILE_ID = "profile_id"
CONF_PALETTE_SIZE = "palette_size"
CONF_OBJECT_LABELS = "object_labels"
CONF_OBJECT_CONFIDENCE = "object_confidence"
CONF_OBJECT_DETAILED = "object_detailed"
CONF_IMAGE_KEY = "image_key"
CONF_IMAGE_REVISION = "image_revision"
CONF_FILE = "file"

DEFAULT_PALETTE_SIZE = 5
MIN_PALETTE_SIZE = 1
MAX_PALETTE_SIZE = 10
DEFAULT_OBJECT_CONFIDENCE = 40
MIN_OBJECT_CONFIDENCE = 5
MAX_OBJECT_CONFIDENCE = 100

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 24_000_000
IMAGE_TYPES = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}


class SourceType(StrEnum):
    """Sources supported by Image Lab."""

    CAMERA = "camera"
    MEDIA_PLAYER = "media_player"
    UPLOAD = "upload"
