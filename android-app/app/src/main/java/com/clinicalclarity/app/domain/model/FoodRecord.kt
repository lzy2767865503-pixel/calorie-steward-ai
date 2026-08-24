package com.clinicalclarity.app.domain.model

data class FoodRecord(
    val id: Long,
    val sourceId: String,
    val name: String,
    val category: String,
    val dataType: String,
    val energyKcalPer100g: Double,
    val proteinGPer100g: Double?,
    val carbohydrateGPer100g: Double?,
    val fatGPer100g: Double?,
    val fibreGPer100g: Double?,
    val sodiumMgPer100g: Double?,
    val servingGrams: Double?,
    val barcode: String?,
    val brand: String?,
    val sourceName: String,
    val sourceUrl: String,
    val qualityGrade: String,
    val datasetVersion: String,
)
