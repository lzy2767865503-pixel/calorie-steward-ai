package com.clinicalclarity.app.data.database

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class CatalogVersionTest {
    @Test
    fun `accepts expected or newer schema only when version and both counts match`() {
        assertTrue(compatible())
        assertTrue(compatible(pragmaSchema = 4, metadataSchema = 4))
        assertFalse(compatible(pragmaSchema = 2))
        assertFalse(compatible(metadataSchema = 2))
        assertFalse(compatible(metadataSchema = null))
        assertFalse(compatible(datasetVersion = "old"))
        assertFalse(compatible(datasetVersion = null))
        assertFalse(compatible(metadataCount = 4_999))
        assertFalse(compatible(metadataCount = null))
        assertFalse(compatible(actualCount = 4_999))
    }

    @Test
    fun `escapes user wildcard characters into a literal like pattern`() {
        assertEquals("%100\\%\\_\\\\%", literalLikePattern("100%_\\"))
    }

    @Test
    fun `checks the full database content hash`() {
        val file = File.createTempFile("catalog-hash-", ".txt")
        try {
            file.writeText("clinical-clarity")
            assertTrue(fileMatchesSha256(file, "a70af322f9a8d4da75af4b6b37855432da83fd4e89de244b7da9e4e0c8140040"))
            assertFalse(fileMatchesSha256(file, "0".repeat(64)))
        } finally {
            file.delete()
        }
    }

    private fun compatible(
        pragmaSchema: Int = 3,
        metadataSchema: Int? = 3,
        datasetVersion: String? = "USDA-FDC-CC-2026.08-v3",
        metadataCount: Int? = 5_000,
        actualCount: Int = 5_000,
    ): Boolean = catalogMetadataIsCompatible(
        pragmaSchemaVersion = pragmaSchema,
        metadataSchemaVersion = metadataSchema,
        datasetVersion = datasetVersion,
        metadataRecordCount = metadataCount,
        actualRecordCount = actualCount,
        expectedSchemaVersion = 3,
        expectedDatasetVersion = "USDA-FDC-CC-2026.08-v3",
        expectedRecordCount = 5_000,
    )
}
