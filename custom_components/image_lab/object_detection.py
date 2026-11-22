"""Detect COCO object categories locally with NanoDet-Plus and ncnn."""

import asyncio
import logging
from collections import Counter
from dataclasses import replace
from functools import lru_cache
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from threading import Lock
from zipfile import ZipFile

from aiohttp import ClientError, ClientTimeout
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.requirements import RequirementsNotFound, async_process_requirements
from homeassistant.util.file import WriteError, write_utf8_file_atomic
from PIL import Image, ImageOps

from .const import DOMAIN
from .images import ImageError, ImageFrame
from .models import ModuleResult

_LOGGER = logging.getLogger(__name__)

# Keep the order of the 80 COCO output channels used by the official NanoDet weights.
LABELS = (
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "airplane",
    "bus",
    "train",
    "truck",
    "boat",
    "traffic_light",
    "fire_hydrant",
    "stop_sign",
    "parking_meter",
    "bench",
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    "backpack",
    "umbrella",
    "handbag",
    "tie",
    "suitcase",
    "frisbee",
    "skis",
    "snowboard",
    "sports_ball",
    "kite",
    "baseball_bat",
    "baseball_glove",
    "skateboard",
    "surfboard",
    "tennis_racket",
    "bottle",
    "wine_glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot_dog",
    "pizza",
    "donut",
    "cake",
    "chair",
    "couch",
    "potted_plant",
    "bed",
    "dining_table",
    "toilet",
    "tv",
    "laptop",
    "mouse",
    "remote",
    "keyboard",
    "cell_phone",
    "microwave",
    "oven",
    "toaster",
    "sink",
    "refrigerator",
    "book",
    "clock",
    "vase",
    "scissors",
    "teddy_bear",
    "hair_drier",
    "toothbrush",
)

_MODEL_URL = (
    "https://github.com/RangiLyu/nanodet/releases/download/"
    "v1.0.0-alpha-1/nanodet-plus-m_416_ncnn.zip"
)
_ARCHIVE_SIZE = 2_218_050
_ARCHIVE_SHA = "16696bb22b77f04d2e098ec1c2ac079d10e7ea94e2c1e0228934345a1bc429e1"
_MODEL_FILES = (
    (
        "nanodet-plus-m_416.param",
        23_123,
        "d79e18ecd8595081bb29fdf0c790a47fcea96fbf58598350569a92e71e915b72",
    ),
    (
        "nanodet-plus-m_416.bin",
        2_397_184,
        "f7555ca6cb9650ee41e2f0a53fdf46b6e187a2a09792208d8c3eec033b6ac615",
    ),
)
_REQUIREMENT = "ncnn>=1.0.20261020"
_SIZE = 416
_STRIDES = (8, 16, 32, 64)
_BINS = 8
_MAX_OBJECTS = 100
_IOU_THRESHOLD = 0.5


def _cached(directory: Path) -> bool:
    """Verify both files before ncnn reads them, including after a restore."""
    for name, size, digest in _MODEL_FILES:
        try:
            with (directory / name).open("rb") as file:
                content = file.read(size + 1)
        except OSError:
            return False
        if len(content) != size or sha256(content).hexdigest() != digest:
            return False
    return True


def _save_model(directory: Path, archive: bytes) -> None:
    if len(archive) != _ARCHIVE_SIZE or sha256(archive).hexdigest() != _ARCHIVE_SHA:
        raise ImageError("object_model_unavailable")
    directory.mkdir(parents=True, exist_ok=True)
    with ZipFile(BytesIO(archive)) as model:
        for name, _, _ in _MODEL_FILES:
            write_utf8_file_atomic(str(directory / name), model.read(name), True, "wb")


@lru_cache(maxsize=1)
def _priors():
    """Return the NanoDet grid points and strides in output row order."""
    import numpy as np

    grids = []
    for stride in _STRIDES:
        side = (_SIZE + stride - 1) // stride
        y, x = np.indices((side, side))
        grids.append(
            np.stack((x * stride, y * stride, np.full_like(x, stride)), axis=-1)
        )
    return np.concatenate([grid.reshape(-1, 3) for grid in grids])


def _decode(
    predictions, labels: list[str], confidence: int, area: tuple[int, int, int, int]
):
    """Map NanoDet predictions to the unpadded image."""
    import numpy as np

    priors = _priors()
    classes = len(LABELS)
    if predictions.shape != (len(priors), classes + 4 * _BINS):
        raise ImageError("object_detection_failed")

    scores = predictions[:, :classes]
    winners = scores.argmax(axis=1)
    scores = scores[np.arange(len(scores)), winners]
    mask = scores >= confidence / 100
    if labels:
        mask &= np.isin(winners, [LABELS.index(label) for label in labels])

    scores, winners = scores[mask], winners[mask]
    x, y, stride = priors[mask].T
    logits = predictions[mask, classes:].reshape(-1, 4, _BINS)
    probabilities = np.exp(logits - logits.max(axis=2, keepdims=True))
    distances = (probabilities @ np.arange(_BINS)) / probabilities.sum(axis=2)
    left, top, right, bottom = (distances * stride[:, None]).T

    offset_x, offset_y, width, height = area
    boxes = np.stack((x - left, y - top, x + right, y + bottom), axis=1)
    boxes = ((boxes - (offset_x, offset_y) * 2) / ((width, height) * 2)).clip(0, 1)
    return boxes, scores, winners


def _suppress(boxes, scores, winners, passes) -> dict:
    """Suppress duplicate boxes across overlapping passes of the same category."""
    import numpy as np

    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    remaining = np.argsort(-scores, kind="stable")
    remaining = remaining[areas[remaining] > 0]

    objects = []
    while remaining.size and len(objects) < _MAX_OBJECTS:
        current, remaining = remaining[0], remaining[1:]
        x_min, y_min, x_max, y_max = (
            round(float(value), 4) for value in boxes[current]
        )
        objects.append(
            {
                "label": LABELS[winners[current]],
                "confidence": round(float(scores[current]), 4),
                "box": {"x_min": x_min, "y_min": y_min, "x_max": x_max, "y_max": y_max},
            }
        )
        # Suppress overlaps only within the same category.
        overlap = np.minimum(boxes[current, 2:], boxes[remaining, 2:]) - np.maximum(
            boxes[current, :2], boxes[remaining, :2]
        )
        intersection = overlap.clip(0).prod(axis=1)
        iou = intersection / (areas[current] + areas[remaining] - intersection)
        # A second scale can produce a smaller, nearly contained box for the same object.
        smaller = np.minimum(areas[current], areas[remaining])
        nested = (
            (passes[current] != passes[remaining])
            & (intersection >= 0.85 * smaller)
            & (iou >= 0.35)
        )
        duplicate = (winners[current] == winners[remaining]) & (
            (iou >= _IOU_THRESHOLD) | nested
        )
        remaining = remaining[~duplicate]

    return {
        "detected": bool(objects),
        "count": len(objects),
        "counts": dict(Counter(item["label"] for item in objects)),
        "objects": objects,
        "truncated": bool(remaining.size),
    }


class _NanoDet:
    def __init__(self, directory: Path) -> None:
        try:
            import ncnn
            import numpy as np
        except (ImportError, OSError) as err:
            raise ImageError("object_engine_unavailable") from err

        self.ncnn = ncnn
        self.np = np
        self.lock = Lock()
        self.net = ncnn.Net()
        self.net.opt.num_threads = 1
        self.net.opt.use_vulkan_compute = False
        param, weights = (str(directory / name) for name, _, _ in _MODEL_FILES)
        if self.net.load_param(param) or self.net.load_model(weights):
            raise ImageError("object_model_unavailable")

    def detect(
        self, frame: ImageFrame, labels: list[str], confidence: int, detailed: bool = False
    ) -> tuple[ModuleResult, ImageFrame]:
        """Run inference and return coordinates relative to the oriented image."""
        try:
            with Image.open(BytesIO(frame.content)) as image:
                ImageOps.exif_transpose(image, in_place=True)
                source = image.convert("RGB")
        except (OSError, SyntaxError, ValueError) as err:
            raise ImageError("invalid_image") from err
        width, height = source.size
        passes = [self._infer(source, labels, confidence)]
        if detailed and min(width, height) > _SIZE:
            # Overlap tiles so objects near one tile's edge are visible in another.
            tile_w, tile_h = width * 4 // 5, height * 4 // 5
            for left in (0, width - tile_w):
                for top in (0, height - tile_h):
                    right, bottom = left + tile_w, top + tile_h
                    tile = source.crop((left, top, right, bottom))
                    boxes, scores, winners = self._infer(tile, labels, confidence)
                    keep = (
                        ((boxes[:, 0] > 0) | (left == 0))
                        & ((boxes[:, 1] > 0) | (top == 0))
                        & ((boxes[:, 2] < 1) | (right == width))
                        & ((boxes[:, 3] < 1) | (bottom == height))
                    )
                    mapped = (
                        (boxes[keep] * ((tile_w, tile_h) * 2) + ((left, top) * 2))
                        / ((width, height) * 2)
                    )
                    passes.append((mapped, scores[keep], winners[keep]))
        boxes, scores, winners = (self.np.concatenate(parts) for parts in zip(*passes))
        pass_ids = self.np.repeat(range(len(passes)), [len(part[0]) for part in passes])
        return (
            ModuleResult(_suppress(boxes, scores, winners, pass_ids)),
            replace(frame, width=width, height=height),
        )

    def _infer(self, image: Image.Image, labels: list[str], confidence: int):
        longest = max(image.size)
        w, h = (max(1, value * _SIZE // longest) for value in image.size)
        x, y = (_SIZE - w) // 2, (_SIZE - h) // 2
        resized = image.resize((w, h), Image.Resampling.BILINEAR)
        padded = Image.new("RGB", (_SIZE, _SIZE))
        padded.paste(resized, (x, y))

        ncnn = self.ncnn
        pixels = self.np.asarray(padded)
        image_mat = ncnn.Mat.from_pixels(
            pixels, ncnn.Mat.PixelType.PIXEL_RGB2BGR, _SIZE, _SIZE
        )
        image_mat.substract_mean_normalize(
            [103.53, 116.28, 123.675], [0.017429, 0.017507, 0.017125]
        )
        with self.lock:
            extractor = self.net.create_extractor()
            if extractor.input("data", image_mat):
                raise ImageError("object_detection_failed")
            status, output = extractor.extract("output")
            if status:
                raise ImageError("object_detection_failed")
            predictions = self.np.array(output, dtype=self.np.float32)

        return _decode(predictions, labels, confidence, (x, y, w, h))


class ObjectDetector:
    """Lazily prepare and share one local NanoDet model across analyses."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._detector: _NanoDet | None = None

    async def async_detect(
        self, hass: HomeAssistant, frame: ImageFrame, labels: list[str], confidence: int,
        detailed: bool,
    ) -> tuple[ModuleResult, ImageFrame]:
        if self._detector is None:
            async with self._lock:
                if self._detector is None:
                    self._detector = await self._async_load(hass)
        return await hass.async_add_executor_job(
            self._detector.detect, frame, labels, confidence, detailed
        )

    async def _async_load(self, hass: HomeAssistant) -> _NanoDet:
        try:
            await async_process_requirements(
                hass, DOMAIN, [_REQUIREMENT], is_built_in=False
            )
        except RequirementsNotFound as err:
            raise ImageError("object_engine_unavailable") from err

        directory = Path(
            hass.config.path(".storage", f"{DOMAIN}.models", "nanodet-plus-m_416")
        )
        if not await hass.async_add_executor_job(_cached, directory):
            session = async_get_clientsession(hass)
            try:
                async with session.get(
                    _MODEL_URL, timeout=ClientTimeout(total=30)
                ) as response:
                    response.raise_for_status()
                    archive = await response.content.readexactly(_ARCHIVE_SIZE)
                    if await response.content.read(1):
                        raise ImageError("object_model_unavailable")
                await hass.async_add_executor_job(_save_model, directory, archive)
            except (
                ClientError,
                OSError,
                TimeoutError,
                asyncio.IncompleteReadError,
                WriteError,
            ) as err:
                _LOGGER.debug(
                    "Could not download or cache the NanoDet model", exc_info=True
                )
                raise ImageError("object_model_unavailable") from err
        return await hass.async_add_executor_job(_NanoDet, directory)
