from __future__ import annotations

import inspect

import pytest

from app.catalog import normalize_food_name
from app.nutrition import NutritionEngine
from app.providers import DemoVisionProvider, VisionCandidate, VisionResult


def test_alias_resolution_is_exact_and_deterministic(catalog) -> None:
    match = catalog.resolve("Cooked white rice")
    assert match is not None
    assert match.food.id == 1
    assert match.score == 1.0
    assert match.basis == "exact_or_alias"


def test_generic_single_token_food_label_is_rejected(catalog) -> None:
    assert catalog.resolve("rice") is None


def test_vision_candidate_type_has_no_nutrition_fields() -> None:
    fields = set(VisionCandidate.__dataclass_fields__)
    assert fields == {"name", "estimated_grams", "confidence"}
    assert "kcal" not in inspect.getsource(VisionCandidate).lower()


def test_duplicate_candidates_merge_before_calculation(catalog) -> None:
    engine = NutritionEngine(catalog)
    vision = VisionResult(
        candidates=(
            VisionCandidate("White rice, cooked", 100.0, 0.9),
            VisionCandidate("cooked white rice", 50.0, 0.8),
        ),
        model_version="unit-test",
        assumptions=("unit",),
        is_demo=True,
    )

    response = engine.estimate("nutrition-test-123", vision)
    assert response.estimatedKcal == 195
    assert len(response.foods) == 1
    assert response.foods[0].estimatedGrams == 150.0
    assert response.foods[0].sharePercent == 100


def test_demo_provider_is_unambiguously_demo(tmp_path) -> None:
    import asyncio

    image_path = tmp_path / "meal.jpg"
    image_path.write_bytes(b"irrelevant")
    result = asyncio.run(
        DemoVisionProvider().analyze(image_path, "image/jpeg", "zh-CN", "MY")
    )
    assert result.is_demo is True
    assert result.model_version.startswith("demo-")
    assert any("演示" in assumption for assumption in result.assumptions)
