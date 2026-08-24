package com.clinicalclarity.app.domain.repository

import com.clinicalclarity.app.domain.model.FoodRecord

interface FoodCatalog {
    fun count(): Int
    fun findByBarcode(barcode: String): FoodRecord?
    fun findById(id: Long): FoodRecord?
    fun search(query: String, limit: Int = 30): List<FoodRecord>
}
