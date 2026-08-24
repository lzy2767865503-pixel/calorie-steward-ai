package com.clinicalclarity.app.data.barcode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GtinTest {
    @Test
    fun `normalizes valid upc a to gtin 14`() {
        assertEquals("00036000291452", Gtin.normalize("036000291452"))
    }

    @Test
    fun `keeps valid gtin 14 and removes separators`() {
        assertEquals("00036000291452", Gtin.normalize("00 036000-291452"))
    }

    @Test
    fun `rejects invalid check digit`() {
        assertNull(Gtin.normalize("036000291453"))
    }

    @Test
    fun `normalizes a barcode that exists in the packaged database`() {
        assertEquals("00016000306509", Gtin.normalize("016000306509"))
    }
}
