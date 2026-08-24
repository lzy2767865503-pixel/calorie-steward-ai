package com.clinicalclarity.app.data.barcode

/** Normalizes valid GTIN-8/UPC-A/GTIN-13/GTIN-14 values to the database's GTIN-14 form. */
object Gtin {
    fun normalize(rawValue: String): String? {
        val digits = rawValue.filter(Char::isDigit)
        if (digits.length !in setOf(8, 12, 13, 14)) return null
        if (!hasValidCheckDigit(digits)) return null
        return digits.padStart(14, '0')
    }

    private fun hasValidCheckDigit(digits: String): Boolean {
        val expected = digits.last().digitToInt()
        var sum = 0
        var weight = 3
        for (index in digits.lastIndex - 1 downTo 0) {
            sum += digits[index].digitToInt() * weight
            weight = if (weight == 3) 1 else 3
        }
        val calculated = (10 - (sum % 10)) % 10
        return calculated == expected
    }
}
