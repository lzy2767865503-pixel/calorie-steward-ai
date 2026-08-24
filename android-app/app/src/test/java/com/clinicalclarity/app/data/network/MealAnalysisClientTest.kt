package com.clinicalclarity.app.data.network

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MealAnalysisClientTest {
    @Test
    fun `accepts a complete internally consistent response`() {
        val result = parseMealAnalysisResponse(validResponse(), "/tmp/meal.jpg")

        assertEquals(620, result.estimatedKcal)
        assertEquals(100, result.items.sumOf { it.sharePercent })
        assertEquals(false, result.isDemo)
    }

    @Test
    fun `rejects response missing isDemo`() {
        val payload = validResponse().apply { remove("isDemo") }

        assertContractFailure(payload)
    }

    @Test
    fun `rejects empty foods array`() {
        val payload = validResponse().put("foods", JSONArray())

        assertContractFailure(payload)
    }

    @Test
    fun `rejects point estimate outside interval`() {
        val payload = validResponse().put("lowKcal", 700)

        assertContractFailure(payload)
    }

    @Test
    fun `rejects food shares that do not total one hundred`() {
        val payload = validResponse()
        payload.getJSONArray("foods").getJSONObject(1).put("sharePercent", 32)

        assertContractFailure(payload)
    }

    @Test
    fun `rejects clearly invalid negative grams`() {
        val payload = validResponse()
        payload.getJSONArray("foods").getJSONObject(0).put("estimatedGrams", -1)

        assertContractFailure(payload)
    }

    @Test
    fun `accepts zero share items when all shares still total one hundred`() {
        val payload = validResponse()
        val foods = payload.getJSONArray("foods")
        foods.getJSONObject(0).put("sharePercent", 100)
        foods.getJSONObject(1).put("sharePercent", 0)
        foods.getJSONObject(2).put("sharePercent", 0)
        foods.getJSONObject(3).put("sharePercent", 0)

        val result = parseMealAnalysisResponse(payload, "/tmp/meal.jpg")

        assertEquals(100, result.items.sumOf { it.sharePercent })
        assertEquals(0, result.items[1].sharePercent)
    }

    @Test
    fun `rejects empty assumptions array`() {
        val payload = validResponse().put("assumptions", JSONArray())

        assertContractFailure(payload)
    }

    private fun assertContractFailure(payload: JSONObject) {
        assertThrows(IllegalArgumentException::class.java) {
            parseMealAnalysisResponse(payload, "/tmp/meal.jpg")
        }
    }

    private fun validResponse(): JSONObject = JSONObject(
        """
        {
          "requestId": "request-test-1",
          "scanId": "scan-test-1",
          "estimatedKcal": 620,
          "lowKcal": 540,
          "highKcal": 710,
          "confidence": 0.86,
          "foods": [
            {
              "foodId": 10,
              "name": "White rice",
              "estimatedGrams": 250.0,
              "estimatedKcal": 325.0,
              "sharePercent": 53,
              "confidence": 0.90,
              "qualityGrade": "A"
            },
            {
              "foodId": 11,
              "name": "Chicken",
              "estimatedGrams": 120.0,
              "estimatedKcal": 205.0,
              "sharePercent": 33,
              "confidence": 0.82,
              "qualityGrade": "C"
            },
            {
              "foodId": 12,
              "name": "Vegetables",
              "estimatedGrams": 100.0,
              "estimatedKcal": 45.0,
              "sharePercent": 7,
              "confidence": 0.78,
              "qualityGrade": "C"
            },
            {
              "foodId": 13,
              "name": "Sauce",
              "estimatedGrams": 15.0,
              "estimatedKcal": 45.0,
              "sharePercent": 7,
              "confidence": 0.70,
              "qualityGrade": "C"
            }
          ],
          "assumptions": ["Oil may be partly hidden"],
          "modelVersion": "vision-test-v1",
          "datasetVersion": "USDA-FDC-CC-2026.08-v1",
          "sourceLabel": "Reviewed nutrition database",
          "isDemo": false
        }
        """.trimIndent(),
    )
}
