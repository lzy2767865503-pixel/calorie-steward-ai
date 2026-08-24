package com.clinicalclarity.app.data.repository

import com.clinicalclarity.app.domain.model.FoodRecord
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PackagedFoodGuardTest {
    @Test
    fun `missing serving grams cannot masquerade as one standard serving`() {
        val error = assertThrows(IllegalArgumentException::class.java) {
            validatedPackagedServingGrams(food(servingGrams = null))
        }

        assertTrue(error.message.orEmpty().contains("缺少可靠"))
    }

    @Test
    fun `zero calorie edible oil rounding trap is rejected`() {
        val error = assertThrows(IllegalArgumentException::class.java) {
            validatedPackagedServingGrams(
                food(
                    category = "Oils Edible",
                    energyKcalPer100g = 0.0,
                    servingGrams = 0.25,
                ),
            )
        }

        assertTrue(error.message.orEmpty().contains("四舍五入"))
    }

    @Test
    fun `positive energy barcode with positive labelled serving is accepted`() {
        assertEquals(30.0, validatedPackagedServingGrams(food()), 0.0)
    }

    private fun food(
        category: String = "Breakfast Cereals",
        energyKcalPer100g: Double = 380.0,
        servingGrams: Double? = 30.0,
    ) = FoodRecord(
        id = 1L,
        sourceId = "test",
        name = "Test food",
        category = category,
        dataType = "Branded",
        energyKcalPer100g = energyKcalPer100g,
        proteinGPer100g = null,
        carbohydrateGPer100g = null,
        fatGPer100g = null,
        fibreGPer100g = null,
        sodiumMgPer100g = null,
        servingGrams = servingGrams,
        barcode = "00000000000000",
        brand = "Test",
        sourceName = "Test source",
        sourceUrl = "https://example.invalid",
        qualityGrade = "A",
        datasetVersion = "test",
    )
}
