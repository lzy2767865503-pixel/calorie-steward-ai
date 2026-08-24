package com.clinicalclarity.app.domain.model

data class EstimatedFoodItem(
    val foodId: Long?,
    val name: String,
    val estimatedGrams: Double,
    val estimatedKcal: Double,
    val sharePercent: Int,
    val confidence: Double,
    val qualityGrade: String,
)

enum class MealSourceKind {
    HOT_MEAL_API,
    PACKAGED_BARCODE,
    NUTRITION_LABEL_OCR,
    OFFLINE_DEMO,
    LEGACY_UNKNOWN,
}

enum class EstimateStatus {
    REQUIRES_CONFIRMATION,
    DEMO,
    OCR_DRAFT,
    LEGACY_UNVERIFIED,
}

data class MealEstimate(
    val scanId: String,
    val imagePath: String?,
    val estimatedKcal: Int,
    val lowKcal: Int,
    val highKcal: Int,
    val confidence: Double,
    val items: List<EstimatedFoodItem>,
    val assumptions: List<String>,
    val modelVersion: String,
    val datasetVersion: String,
    val sourceLabel: String,
    val isDemo: Boolean,
    val sourceKind: MealSourceKind = MealSourceKind.LEGACY_UNKNOWN,
    val status: EstimateStatus = EstimateStatus.LEGACY_UNVERIFIED,
)

data class MealLog(
    val id: Long,
    val recordedAtEpochMs: Long,
    val mealType: String,
    val estimate: MealEstimate,
)

sealed interface ScanUiState {
    data object Ready : ScanUiState
    data class Analyzing(val message: String) : ScanUiState
    data class Result(
        val estimate: MealEstimate,
        val saved: Boolean = false,
        val saving: Boolean = false,
    ) : ScanUiState
    data class Error(val message: String) : ScanUiState
}
