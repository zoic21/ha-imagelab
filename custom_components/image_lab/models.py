"""Results shared by the image analysis modules."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ModuleResult:
    """Module data and the optional reason for an inconclusive result."""

    data: dict
    reason: str | None = None
