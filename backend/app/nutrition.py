from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from decimal import Decimal, ROUND_FLOOR, ROUND_HALF_UP
from typing import Dict, Iterable, List, Sequence, Tuple

from .catalog import CatalogFood, CatalogMatch, SqliteFoodCatalog
from .models import FoodEstimateResponse, MealAnalysisResponse
from .providers import VisionCandidate, VisionResult


class NutritionEstimationError(RuntimeError):
    pass


class UnmatchedFoodError(NutritionEstimationError):
    pass


QUALITY_CONFIDENCE = {"A": 0.98, "B": 0.93, "C": 0.85, "D": 0.72}
QUALITY_RELATIVE_UNCERTAINTY = {"A": 0.03, "B": 0.08, "C": 0.15, "D": 0.25}


def _round_half_up(value: float, places: int = 0) -> float:
    quantum = Decimal("1") if places == 0 else Decimal("1").scaleb(-places)
    return float(Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def _percentage_shares(values: Sequence[float]) -> List[int]:
    total = sum(values)
    if total <= 0:
        base = [0] * len(values)
        for index in range(100):
            base[index % len(base)] += 1
        return base

    raw = [Decimal(str(value)) * Decimal(100) / Decimal(str(total)) for value in values]
    floors = [int(value.to_integral_value(rounding=ROUND_FLOOR)) for value in raw]
    remainder = 100 - sum(floors)
    order = sorted(
        range(len(raw)),
        key=lambda index: (raw[index] - floors[index], -index),
        reverse=True,
    )
    for index in order[:remainder]:
        floors[index] += 1
    return floors


@dataclass
class _ResolvedItem:
    food: CatalogFood
    grams: float
    candidate_confidence: float
    match_score: float


class NutritionEngine:
    """Calculates energy only from catalog density and provider-estimated grams."""

    calculation_version = "energy-density-v1"

    def __init__(self, catalog: SqliteFoodCatalog, max_candidates: int = 12) -> None:
        self.catalog = catalog
        self.max_candidates = max_candidates

    def estimate(
        self,
        request_id: str,
        vision: VisionResult,
    ) -> MealAnalysisResponse:
        if not vision.candidates:
            raise NutritionEstimationError("vision provider returned no food candidates")
        if len(vision.candidates) > self.max_candidates:
            raise NutritionEstimationError("vision provider returned too many food candidates")

        resolved = self._resolve_and_merge(vision.candidates)
        kcal_values = [item.food.energy_kcal_100g * item.grams / 100.0 for item in resolved]
        total_kcal = sum(kcal_values)
        if total_kcal <= 0:
            raise NutritionEstimationError("resolved meal has no calculable energy")

        shares = _percentage_shares(kcal_values)
        response_foods: List[FoodEstimateResponse] = []
        low_total = 0.0
        high_total = 0.0
        confidence_numerator = 0.0

        for item, kcal, share in zip(resolved, kcal_values, shares):
            grade = item.food.quality_grade if item.food.quality_grade in QUALITY_CONFIDENCE else "D"
            quality_confidence = QUALITY_CONFIDENCE[grade]
            item_confidence = max(
                0.05,
                min(0.99, item.candidate_confidence * item.match_score * quality_confidence),
            )

            portion_uncertainty = 0.10 + 0.45 * (1.0 - item.candidate_confidence)
            match_uncertainty = 0.20 * (1.0 - item.match_score)
            data_uncertainty = QUALITY_RELATIVE_UNCERTAINTY[grade]
            combined_uncertainty = min(
                0.65,
                math.sqrt(
                    portion_uncertainty**2 + match_uncertainty**2 + data_uncertainty**2
                ),
            )
            low_total += max(0.0, kcal * (1.0 - combined_uncertainty))
            high_total += kcal * (1.0 + combined_uncertainty)
            confidence_numerator += kcal * item_confidence

            response_foods.append(
                FoodEstimateResponse(
                    foodId=item.food.id,
                    name=item.food.name,
                    estimatedGrams=_round_half_up(item.grams, 1),
                    estimatedKcal=_round_half_up(kcal, 1),
                    sharePercent=share,
                    confidence=_round_half_up(item_confidence, 3),
                    qualityGrade=grade,
                )
            )

        point = int(_round_half_up(total_kcal))
        low = min(point, int(_round_half_up(low_total)))
        high = max(point, int(_round_half_up(high_total)))
        overall_confidence = confidence_numerator / total_kcal

        assumptions = list(vision.assumptions)
        assumptions.extend(
            (
                "热量由版本化食品库按每100克能量值 × 估计克重确定性计算，视觉结果不提供热量。",
                "区间综合了克重、食品匹配与资料等级的不确定性，不等同于实验室检测。",
                f"计算引擎版本：{self.calculation_version}。",
            )
        )

        return MealAnalysisResponse(
            requestId=request_id,
            scanId=str(uuid.uuid4()),
            estimatedKcal=point,
            lowKcal=low,
            highKcal=high,
            confidence=_round_half_up(overall_confidence, 3),
            foods=response_foods,
            assumptions=assumptions,
            modelVersion=vision.model_version,
            datasetVersion=self.catalog.dataset_version,
            sourceLabel=self.catalog.source_label,
            isDemo=vision.is_demo,
        )

    def _resolve_and_merge(self, candidates: Sequence[VisionCandidate]) -> List[_ResolvedItem]:
        merged: Dict[int, _ResolvedItem] = {}
        unmatched = False

        for candidate in candidates:
            match = self.catalog.resolve(candidate.name)
            if match is None:
                unmatched = True
                continue
            previous = merged.get(match.food.id)
            if previous is None:
                merged[match.food.id] = _ResolvedItem(
                    food=match.food,
                    grams=candidate.estimated_grams,
                    candidate_confidence=candidate.confidence,
                    match_score=match.score,
                )
                continue

            combined_grams = previous.grams + candidate.estimated_grams
            combined_confidence = (
                previous.candidate_confidence * previous.grams
                + candidate.confidence * candidate.estimated_grams
            ) / combined_grams
            previous.grams = combined_grams
            previous.candidate_confidence = combined_confidence
            previous.match_score = min(previous.match_score, match.score)

        if unmatched or not merged:
            raise UnmatchedFoodError(
                "one or more visual candidates could not be matched reliably"
            )
        return list(merged.values())

