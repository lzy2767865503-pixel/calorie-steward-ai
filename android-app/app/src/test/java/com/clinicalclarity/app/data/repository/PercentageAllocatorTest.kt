package com.clinicalclarity.app.data.repository

import org.junit.Assert.assertEquals
import org.junit.Test

class PercentageAllocatorTest {
    @Test
    fun `offline demonstration shares add to exactly one hundred`() {
        val shares = allocatePercentages(listOf(325.0, 205.0, 45.0, 45.0))

        assertEquals(listOf(53, 33, 7, 7), shares)
        assertEquals(100, shares.sum())
    }
}
