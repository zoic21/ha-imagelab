"""Extract colors from a still image using the music_colors Pyscript algorithm."""

from colorsys import hsv_to_rgb, rgb_to_hsv
from math import dist, sqrt

from PIL import Image

from .images import ImageFrame, Region, analysis_pixels
from .models import ModuleResult

type RGB = tuple[float, float, float]
type Bucket = tuple[RGB, int]


def _hsv(rgb: RGB) -> RGB:
    red, green, blue = rgb
    return rgb_to_hsv(red / 255, green / 255, blue / 255)


def _vivid(rgb: RGB) -> list[int]:
    hue, saturation, value = _hsv(rgb)
    color = hsv_to_rgb(hue, min(1.0, saturation * 1.04), min(1.0, value * 1.05))
    return [round(channel * 255) for channel in color]


def _buckets(source: Image.Image) -> tuple[list[Bucket], list[Bucket]]:
    colored: dict[tuple[int, int, int], list[int]] = {}
    neutral: dict[tuple[int, int, int], list[int]] = {}
    source.thumbnail((128, 128))
    for red, green, blue, alpha in source.convert("RGBA").get_flattened_data():
        if alpha < 128:
            continue
        value = max(red, green, blue) / 255
        if value < 0.18:
            continue
        # Bucket assignment uses saturation and value, with no need for hue.
        saturation = (value - min(red, green, blue) / 255) / value
        key = red // 32, green // 32, blue // 32
        target = neutral if saturation < 0.18 else colored
        bucket = target.setdefault(key, [0, 0, 0, 0])
        bucket[0] += 1
        bucket[1] += red
        bucket[2] += green
        bucket[3] += blue

    def averages(buckets: dict[tuple[int, int, int], list[int]]) -> list[Bucket]:
        return [
            ((red / count, green / count, blue / count), count)
            for count, red, green, blue in buckets.values()
        ]

    return averages(colored), averages(neutral)


def _select_colors(buckets: list[Bucket], size: int) -> list[RGB]:
    minimum = max(2, sum(count for _, count in buckets) * 0.005)
    candidates = sorted(
        (bucket for bucket in buckets if bucket[1] >= minimum),
        key=lambda bucket: bucket[1],
        reverse=True,
    )[:64]
    if not candidates:
        return []

    primary, _ = max(candidates, key=lambda bucket: bucket[1] * (0.5 + _hsv(bucket[0])[1]))
    selected = [primary]
    maximum_count = candidates[0][1]
    while len(selected) < size:
        best_color = None
        best_score = -1.0
        for rgb, count in candidates:
            separation = min(dist(rgb, previous) for previous in selected)
            if separation < 24:
                continue
            score = separation * (0.35 + 0.65 * sqrt(count / maximum_count))
            if score > best_score:
                best_color = rgb
                best_score = score
        if best_color is None:
            break
        selected.append(best_color)

    if len(selected) > 1:
        # Keep the strongest contrast in the first pair for two-light automations.
        secondary = max(selected[1:], key=lambda rgb: dist(primary, rgb))
        primary_hue = _hsv(primary)[0]
        accents = sorted(
            (rgb for rgb in selected[1:] if rgb != secondary),
            key=lambda rgb: (_hsv(rgb)[0] - primary_hue) % 1.0,
        )
        return [primary, secondary, *accents]
    return selected


def extract_palette(
    frame: ImageFrame, size: int, region: Region | None = None,
) -> tuple[ModuleResult, ImageFrame]:
    """Return a fixed-length palette, repeating colors when needed."""
    with analysis_pixels(frame, region) as (image, preview):
        colored, neutral = _buckets(image)
    selected = _select_colors(colored, size)
    source = "image"
    if not selected and neutral:
        selected = [max(neutral, key=lambda bucket: bucket[1])[0]]
        source = "image_neutral"
    extracted_count = len(selected)
    if not selected:
        selected = [(220, 220, 220)]
        source = "neutral_fallback"

    colors = [_vivid(selected[index % len(selected)]) for index in range(size)]
    hex_colors = ["#{:02X}{:02X}{:02X}".format(*rgb) for rgb in colors]
    result = {
        "dominant_rgb": colors[0],
        "dominant_hex": hex_colors[0],
        "palette_rgb": colors,
        "palette_hex": hex_colors,
        "extracted_count": extracted_count,
        "derived_count": 0,
        "repeated_count": size - len(selected),
        "palette_source": source,
    }
    for index, (rgb, hex_color) in enumerate(zip(colors, hex_colors), 1):
        result[f"color{index}_rgb"] = rgb
        result[f"color{index}"] = hex_color
    return ModuleResult(result), preview
