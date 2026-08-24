package com.clinicalclarity.app.data.database

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.clinicalclarity.app.domain.model.EstimatedFoodItem
import com.clinicalclarity.app.domain.model.EstimateStatus
import com.clinicalclarity.app.domain.model.MealEstimate
import com.clinicalclarity.app.domain.model.MealSourceKind
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MealLogStoreIntegrationTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val zone = ZoneId.of("Asia/Kuala_Lumpur")
    private val instant = Instant.parse("2026-08-18T04:15:00Z")
    private lateinit var store: MealLogStore

    @Before
    fun setUp() {
        context.deleteDatabase(DATABASE_NAME)
        store = MealLogStore(
            context = context,
            clock = Clock.fixed(instant, zone),
            zoneProvider = { zone },
        )
    }

    @After
    fun tearDown() {
        store.close()
        context.deleteDatabase(DATABASE_NAME)
    }

    @Test
    fun confirmedSaveIsIdempotentAuditableAndSoftDeleteCanBeUndone() {
        val estimate = confirmedEstimate()

        val inserted = store.save(estimate, goalKcal = 2_100)
        val duplicate = store.save(estimate, goalKcal = 2_100)
        val date = LocalDate.of(2026, 8, 18)
        val saved = store.listActive(date, date.plusDays(1)).single()

        assertTrue(inserted is SaveMealResult.Inserted)
        assertTrue(duplicate is SaveMealResult.AlreadyExists)
        assertEquals(inserted.id, duplicate.id)
        UUID.fromString(saved.entryId)
        assertEquals("2026-08-18", saved.localDate.toString())
        assertEquals("Asia/Kuala_Lumpur", saved.recordedZoneId)
        assertEquals(8 * 60 * 60, saved.recordedOffsetSeconds)
        assertEquals("午餐", saved.mealType)
        assertEquals(2_100, saved.goalKcalAtLog)
        assertEquals(MealRecordStatus.CONFIRMED, saved.recordStatus)
        assertEquals(MealSourceKind.HOT_MEAL_API, saved.sourceKind)
        assertTrue(saved.isConfirmed)
        assertTrue(!saved.isDemo)
        assertEquals(listOf("份量由照片估算"), saved.assumptions)

        assertTrue(store.softDelete(saved.id))
        assertTrue(store.listActive(date, date.plusDays(1)).isEmpty())
        assertEquals(null, store.trackingStartDate())
        assertTrue(store.restore(saved.id))
        assertEquals(1, store.listActive(date, date.plusDays(1)).size)
        assertEquals(date, store.trackingStartDate())
        assertTrue(store.softDelete(saved.id))
        assertTrue(store.purge(saved.id))
        assertTrue(store.listRecent().isEmpty())
    }

    @Test
    fun demoAndDraftResultsAreRejectedBeforePersistence() {
        val demo = confirmedEstimate().copy(
            isDemo = true,
            sourceKind = MealSourceKind.OFFLINE_DEMO,
            status = EstimateStatus.DEMO,
        )
        val draft = confirmedEstimate().copy(
            sourceKind = MealSourceKind.NUTRITION_LABEL_OCR,
            status = EstimateStatus.OCR_DRAFT,
        )

        assertThrows(IllegalArgumentException::class.java) { store.save(demo, goalKcal = null) }
        assertThrows(IllegalArgumentException::class.java) { store.save(draft, goalKcal = null) }
        assertTrue(store.listRecent().isEmpty())
    }

    @Test
    fun goalHistoryPersistsExplicitSettingAndCancellation() {
        store.recordGoalSetting(2_000)
        assertEquals(2_000, store.currentGoalKcal())
        store.recordGoalSetting(null)

        val events = store.listGoalEvents(LocalDate.of(2026, 8, 19))

        assertEquals(2, events.size)
        assertEquals(2_000, events[0].goalKcal)
        assertEquals(null, events[1].goalKcal)
        assertEquals(null, store.currentGoalKcal())
        assertEquals(LocalDate.of(2026, 8, 18), store.trackingStartDate())
    }

    private fun confirmedEstimate(): MealEstimate = MealEstimate(
        scanId = "scan-confirmed-20260818",
        imagePath = null,
        estimatedKcal = 620,
        lowKcal = 540,
        highKcal = 710,
        confidence = 0.78,
        items = listOf(
            EstimatedFoodItem(
                foodId = 1L,
                name = "测试餐食",
                estimatedGrams = 350.0,
                estimatedKcal = 620.0,
                sharePercent = 100,
                confidence = 0.78,
                qualityGrade = "B",
            ),
        ),
        assumptions = listOf("份量由照片估算"),
        modelVersion = "meal-vision-test",
        datasetVersion = "test-dataset",
        sourceLabel = "测试视觉服务",
        isDemo = false,
        sourceKind = MealSourceKind.HOT_MEAL_API,
        status = EstimateStatus.REQUIRES_CONFIRMATION,
    )

    private companion object {
        const val DATABASE_NAME = "meal_log.sqlite"
    }
}
