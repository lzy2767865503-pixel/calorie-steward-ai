from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FoodEstimateResponse(StrictModel):
    foodId: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=300)
    estimatedGrams: float = Field(gt=0, le=3000)
    estimatedKcal: float = Field(ge=0)
    sharePercent: int = Field(ge=0, le=100)
    confidence: float = Field(ge=0, le=1)
    qualityGrade: str = Field(pattern=r"^[A-D]$")


class MealAnalysisResponse(StrictModel):
    requestId: str = Field(min_length=8, max_length=128)
    scanId: str = Field(min_length=8, max_length=128)
    estimatedKcal: int = Field(ge=0)
    lowKcal: int = Field(ge=0)
    highKcal: int = Field(ge=0)
    confidence: float = Field(ge=0, le=1)
    foods: List[FoodEstimateResponse] = Field(min_length=1, max_length=12)
    assumptions: List[str] = Field(min_length=1, max_length=30)
    modelVersion: str = Field(min_length=1, max_length=120)
    datasetVersion: str = Field(min_length=1, max_length=200)
    sourceLabel: str = Field(min_length=1, max_length=300)
    isDemo: bool

    @model_validator(mode="after")
    def validate_interval_and_shares(self) -> "MealAnalysisResponse":
        if not self.lowKcal <= self.estimatedKcal <= self.highKcal:
            raise ValueError("calorie interval must contain the point estimate")
        if sum(item.sharePercent for item in self.foods) != 100:
            raise ValueError("food calorie shares must sum to 100")
        return self


class ErrorDetail(StrictModel):
    code: str
    message: str
    requestId: str


class ErrorResponse(StrictModel):
    detail: ErrorDetail


class HealthResponse(StrictModel):
    status: str
    datasetVersion: str
    catalogFoodCount: int = Field(ge=0)
    providerMode: str

