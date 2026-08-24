from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence


@dataclass(frozen=True)
class VisionCandidate:
    """A visual hypothesis only. Nutrition fields are intentionally absent."""

    name: str
    estimated_grams: float
    confidence: float

    def __post_init__(self) -> None:
        cleaned_name = self.name.strip()
        if not cleaned_name:
            raise ValueError("candidate name cannot be empty")
        if not 0 < self.estimated_grams <= 3000:
            raise ValueError("estimated grams must be in (0, 3000]")
        if not 0 <= self.confidence <= 1:
            raise ValueError("candidate confidence must be in [0, 1]")
        object.__setattr__(self, "name", cleaned_name)


@dataclass(frozen=True)
class VisionResult:
    candidates: Sequence[VisionCandidate]
    model_version: str
    assumptions: Sequence[str]
    is_demo: bool

    def __post_init__(self) -> None:
        cleaned_version = self.model_version.strip()
        if not cleaned_version or len(cleaned_version) > 120:
            raise ValueError("model version must contain 1 to 120 characters")
        if len(self.assumptions) > 27:
            raise ValueError("vision provider returned too many assumptions")
        cleaned_assumptions = tuple(
            assumption.strip()[:500]
            for assumption in self.assumptions
            if assumption and assumption.strip()
        )
        object.__setattr__(self, "candidates", tuple(self.candidates))
        object.__setattr__(self, "model_version", cleaned_version)
        object.__setattr__(self, "assumptions", cleaned_assumptions)


class VisionProvider(Protocol):
    """Injectable boundary for visual recognition.

    A production implementation may inspect the temporary local image and return
    candidate names, estimated grams, confidence, version and assumptions only.
    It must never return calories, macros or nutrition-density values. Those are
    exclusively resolved from the versioned catalog by ``NutritionEngine``.
    """

    async def analyze(
        self,
        image_path: Path,
        mime_type: str,
        locale: str,
        market: str,
    ) -> VisionResult:
        ...


class DemoVisionProvider:
    """Explicit non-AI fixture used until a reviewed provider is injected."""

    model_version = "demo-vision-fixture-v1"
    mode_label = "demo"

    async def analyze(
        self,
        image_path: Path,
        mime_type: str,
        locale: str,
        market: str,
    ) -> VisionResult:
        # The bytes are deliberately not interpreted. This is a stable fixture,
        # not an image-recognition claim.
        return VisionResult(
            candidates=(
                VisionCandidate("Rice, white, cooked, no added fat", 180.0, 0.72),
                VisionCandidate(
                    "Chicken, broiler or fryers, breast, skinless, boneless, "
                    "meat only, cooked, braised",
                    120.0,
                    0.68,
                ),
                VisionCandidate("Cucumber, with peel, raw", 45.0, 0.70),
                VisionCandidate("Soup, broth", 140.0, 0.55),
            ),
            model_version=self.model_version,
            assumptions=(
                "当前为显式演示识别：结果来自固定样例，并未分析上传图片。",
                "份量仅用于验证端到端流程；正式记录前必须由用户确认。",
            ),
            is_demo=True,
        )
