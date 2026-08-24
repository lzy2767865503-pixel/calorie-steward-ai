package com.clinicalclarity.app.data.database

import android.os.SystemClock
import android.util.Log
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.clinicalclarity.app.BuildConfig
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AssetFoodCatalogIntegrationTest {
    @Test
    fun installsOrUpgradesCatalogAndQueriesFiveThousandRows() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val installedDatabase = File(context.noBackupFilesDir, AssetFoodCatalog.DATABASE_NAME)
        // A clean connected test still exercises replacement of an invalid file. For the explicit
        // v2 -> v3 device audit, the harness injects the real v2 DB before invoking this method.
        if (!installedDatabase.isFile) installedDatabase.writeText("stale-development-database")

        val catalog = AssetFoodCatalog(context)
        val retainedV2Food = catalog.findByBarcode("076150232585")
        val addedGroceryFood = catalog.findByBarcode("051000231840")

        assertNotNull(retainedV2Food)
        assertEquals("USDA-FDC-2771184", retainedV2Food?.sourceId)
        assertNotNull(addedGroceryFood)
        assertEquals("USDA-FDC-2219929", addedGroceryFood?.sourceId)
        assertEquals(BuildConfig.DATASET_RECORD_COUNT, catalog.count())
        assertTrue(fileMatchesSha256(installedDatabase, BuildConfig.DATASET_SHA256))

        val searchStarted = SystemClock.elapsedRealtimeNanos()
        val searchResults = catalog.search("Beef Chili", limit = 30)
        val searchElapsedMs = (SystemClock.elapsedRealtimeNanos() - searchStarted) / 1_000_000L
        Log.i("CatalogPerformance", "search_5000_rows_ms=$searchElapsedMs")
        assertTrue(searchResults.any { it.sourceId == "USDA-FDC-2219929" })
        assertTrue("5,000-row search took ${searchElapsedMs}ms", searchElapsedMs < 2_000L)
    }
}
