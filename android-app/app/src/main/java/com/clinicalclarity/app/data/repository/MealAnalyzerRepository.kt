package com.clinicalclarity.app.data.repository

import com.clinicalclarity.app.BuildConfig
import com.clinicalclarity.app.data.image.ImageSanitizer
import com.clinicalclarity.app.data.network.MealAnalysisClient
import com.clinicalclarity.app.domain.model.EstimatedFoodItem
import com.clinicalclarity.app.domain.model.EstimateStatus
import com.clinicalclarity.app.domain.model.FoodRecord
import com.clinicalclarity.app.domain.model.MealEstimate
import com.clinicalclarity.app.domain.model.MealSourceKind
import java.io.File
import java.util.UUID
import kotlin.math.roundToInt

class MealAnalyzerRepository(
    private val sanitizer: ImageSanitizer,
    private val remote: MealAnalysisClient,
) {
    suspend fun analyzeHotMeal(source: File): MealEstimate {
        val sanitized = sanitizer.sanitize(source)
        val requestId = UUID.randomUUID().toString()
        return try {
            runCatching { remote.analyze(sanitized, requestId) }
                .getOrElse { offlineDemonstration(sanitized, requestId) }
                .copy(imagePath = source.path)
        } finally {
            sanitized.delete()
        }
    }

    fun fromPackagedFood(food: FoodRecord, imagePath: String? = null): MealEstimate {
        val grams = validatedPackagedServingGrams(food)
        val kcal = grams / 100.0 * food.energyKcalPer100g
        val rounded = kcal.roundToInt()
        return MealEstimate(
            scanId = "barcode-${UUID.randomUUID()}",
            imagePath = imagePath,
            estimatedKcal = rounded,
            lowKcal = (kcal * 0.75).roundToInt(),
            highKcal = (kcal * 1.25).roundToInt(),
            confidence = 0.65,
            items = listOf(
                EstimatedFoodItem(
                    foodId = food.id,
                    name = food.name,
                    estimatedGrams = grams,
                    estimatedKcal = kcal,
                    sharePercent = 100,
                    confidence = 0.65,
                    qualityGrade = food.qualityGrade,
                ),
            ),
            assumptions = listOf(
                "营养数值与条码在审核食物库中精确匹配",
                "初始值按标签 1 标准份 ${grams.roundToInt()} g 计算",
                "实际摄入量尚未测量，请在结果页选择实际份数后再确认",
                "显示范围按所选自报份数的 0.75–1.25 倍计算，不是对实际摄入的称重",
            ),
            modelVersion = "barcode-exact-v1",
            datasetVersion = BuildConfig.DATASET_VERSION,
            sourceLabel = "${food.sourceName} · 条码精确匹配",
            isDemo = false,
            sourceKind = MealSourceKind.PACKAGED_BARCODE,
            status = EstimateStatus.REQUIRES_CONFIRMATION,
        )
    }

    private fun offlineDemonstration(image: File, requestId: String): MealEstimate {
        val kcalValues = listOf(325.0, 205.0, 45.0, 45.0)
        val shares = allocatePercentages(kcalValues)
        val items = listOf(
            EstimatedFoodItem(null, "白米饭", 250.0, kcalValues[0], shares[0], 0.62, "A"),
            EstimatedFoodItem(null, "白切鸡（带皮）", 120.0, kcalValues[1], shares[1], 0.58, "C"),
            EstimatedFoodItem(null, "清炒青菜", 100.0, kcalValues[2], shares[2], 0.53, "C"),
            EstimatedFoodItem(null, "辣椒酱", 15.0, kcalValues[3], shares[3], 0.45, "C"),
        )
        return MealEstimate(
            scanId = "offline-$requestId",
            imagePath = image.path,
            estimatedKcal = 620,
            lowKcal = 540,
            highKcal = 710,
            confidence = 0.58,
            items = items,
            assumptions = listOf("视觉后端未连接，当前使用审核演示餐例", "结果不能作为真实照片结论"),
            modelVersion = "offline-demo-v1",
            datasetVersion = BuildConfig.DATASET_VERSION,
            sourceLabel = "离线演示 · 待连接视觉服务",
            isDemo = true,
            sourceKind = MealSourceKind.OFFLINE_DEMO,
            status = EstimateStatus.DEMO,
        )
    }
}

/** Fail closed when a barcode row cannot support the UI's "label standard serving" claim. */
internal fun validatedPackagedServingGrams(food: FoodRecord): Double {
    val grams = food.servingGrams
    require(grams != null && grams.isFinite() && grams > 0.0) {
        "该条码缺少可靠的标签标准份量，请改拍营养标签核对；当前结果不能记录。"
    }
    require(food.energyKcalPer100g.isFinite() && food.energyKcalPer100g >= 0.0) {
        "该条码的能量数据无效，请核对包装标签。"
    }
    val looksLikeEdibleOil = listOf(food.category, food.name, food.dataType)
        .any { value ->
            value.contains("oil", ignoreCase = true) ||
                value.contains("食用油") ||
                value.contains("油脂")
        }
    require(!(looksLikeEdibleOil && food.energyKcalPer100g <= 0.0)) {
        "食用油的标签 0 kcal 可能来自小份量四舍五入，不能作为科学记录；请核对克重与标签。"
    }
    return grams
}

internal fun allocatePercentages(values: List<Double>): List<Int> {
    if (values.isEmpty()) return emptyList()
    val nonNegative = values.map { it.coerceAtLeast(0.0) }
    val total = nonNegative.sum()
    if (total <= 0.0) return List(values.size) { 0 }
    val exact = nonNegative.map { it / total * 100.0 }
    val allocated = exact.map { kotlin.math.floor(it).toInt() }.toMutableList()
    val remaining = 100 - allocated.sum()
    exact.indices
        .sortedWith(compareByDescending<Int> { exact[it] - allocated[it] }.thenBy { it })
        .take(remaining)
        .forEach { allocated[it] += 1 }
    check(allocated.sum() == 100) { "百分比分配失败" }
    return allocated
}
