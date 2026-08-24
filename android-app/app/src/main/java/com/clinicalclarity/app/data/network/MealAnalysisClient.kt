package com.clinicalclarity.app.data.network

import com.clinicalclarity.app.domain.model.EstimatedFoodItem
import com.clinicalclarity.app.domain.model.EstimateStatus
import com.clinicalclarity.app.domain.model.MealEstimate
import com.clinicalclarity.app.domain.model.MealSourceKind
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class MealAnalysisClient(
    private val baseUrl: String,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build(),
) {
    fun analyze(image: File, requestId: String): MealEstimate {
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("request_id", requestId)
            .addFormDataPart("locale", "zh-CN")
            .addFormDataPart("market", "MY")
            .addFormDataPart("image", image.name, image.asRequestBody("image/jpeg".toMediaType()))
            .build()

        val request = Request.Builder()
            .url(baseUrl.trimEnd('/') + "/v1/analyze-meal")
            .header("Accept", "application/json")
            .header("X-Request-Id", requestId)
            .post(body)
            .build()

        client.newCall(request).execute().use { response ->
            val payload = response.body.string()
            check(response.isSuccessful) { "识别服务暂时不可用（${response.code}）" }
            return parseMealAnalysisResponse(JSONObject(payload), image.path)
        }
    }
}

internal fun parseMealAnalysisResponse(root: JSONObject, imagePath: String): MealEstimate {
    root.requiredString("requestId", minimumLength = 8, maximumLength = 128)
    val pointKcal = root.requiredInt("estimatedKcal", 0..Int.MAX_VALUE)
    val lowKcal = root.requiredInt("lowKcal", 0..Int.MAX_VALUE)
    val highKcal = root.requiredInt("highKcal", 0..Int.MAX_VALUE)
    contract(lowKcal <= pointKcal && pointKcal <= highKcal) {
        "lowKcal <= estimatedKcal <= highKcal"
    }

    val foodsJson = root.requiredArray("foods")
    contract(foodsJson.length() in 1..MAX_FOOD_ITEMS) { "foods 必须包含 1–$MAX_FOOD_ITEMS 项" }
    val items = buildList {
        for (index in 0 until foodsJson.length()) {
            val item = foodsJson.requiredObject(index, "foods[$index]")
            add(
                EstimatedFoodItem(
                    foodId = item.requiredPositiveLong("foodId"),
                    name = item.requiredString("name", maximumLength = 300),
                    estimatedGrams = item.requiredDouble("estimatedGrams", minimum = 0.001, maximum = MAX_ITEM_GRAMS),
                    estimatedKcal = item.requiredDouble("estimatedKcal", minimum = 0.0, maximum = Double.MAX_VALUE),
                    sharePercent = item.requiredInt("sharePercent", 0..100),
                    confidence = item.requiredDouble("confidence", minimum = 0.0, maximum = 1.0),
                    qualityGrade = item.requiredString("qualityGrade", maximumLength = 1).also { grade ->
                        contract(grade in setOf("A", "B", "C", "D")) { "qualityGrade 必须为 A–D" }
                    },
                ),
            )
        }
    }
    contract(items.sumOf(EstimatedFoodItem::sharePercent) == 100) { "foods.sharePercent 合计必须为 100" }

    val assumptionsJson = root.requiredArray("assumptions")
    contract(assumptionsJson.length() in 1..MAX_ASSUMPTIONS) { "assumptions 必须包含 1–$MAX_ASSUMPTIONS 项" }
    val assumptions = buildList {
        for (index in 0 until assumptionsJson.length()) {
            val value = assumptionsJson.get(index)
            contract(value is String && value.isNotBlank()) { "assumptions[$index] 必须是非空字符串" }
            add(value as String)
        }
    }

    val isDemo = root.requiredBoolean("isDemo")
    return MealEstimate(
        scanId = root.requiredString("scanId", minimumLength = 8, maximumLength = 128),
        imagePath = imagePath,
        estimatedKcal = pointKcal,
        lowKcal = lowKcal,
        highKcal = highKcal,
        confidence = root.requiredDouble("confidence", minimum = 0.0, maximum = 1.0),
        items = items,
        assumptions = assumptions,
        modelVersion = root.requiredString("modelVersion", maximumLength = 120),
        datasetVersion = root.requiredString("datasetVersion", maximumLength = 200),
        sourceLabel = root.requiredString("sourceLabel", maximumLength = 300),
        isDemo = isDemo,
        sourceKind = MealSourceKind.HOT_MEAL_API,
        status = if (isDemo) EstimateStatus.DEMO else EstimateStatus.REQUIRES_CONFIRMATION,
    )
}

private fun JSONObject.requiredValue(key: String): Any {
    contract(has(key) && !isNull(key)) { "缺少必填字段 $key" }
    return get(key)
}

private fun JSONObject.requiredString(
    key: String,
    minimumLength: Int = 1,
    maximumLength: Int = Int.MAX_VALUE,
): String {
    val value = requiredValue(key)
    contract(value is String) { "$key 必须是字符串" }
    val text = value as String
    contract(text.isNotBlank() && text.length in minimumLength..maximumLength) {
        "$key 必须是长度 $minimumLength–$maximumLength 的非空字符串"
    }
    return text
}

private fun JSONObject.requiredBoolean(key: String): Boolean {
    val value = requiredValue(key)
    contract(value is Boolean) { "$key 必须是 Boolean" }
    return value as Boolean
}

private fun JSONObject.requiredArray(key: String): JSONArray {
    val value = requiredValue(key)
    contract(value is JSONArray) { "$key 必须是数组" }
    return value as JSONArray
}

private fun JSONArray.requiredObject(index: Int, path: String): JSONObject {
    val value = get(index)
    contract(value is JSONObject) { "$path 必须是对象" }
    return value as JSONObject
}

private fun JSONObject.requiredInt(key: String, range: IntRange): Int {
    val value = requiredValue(key)
    contract(value is Number) { "$key 必须是数字" }
    val number = (value as Number).toDouble()
    contract(number.isFinite() && number % 1.0 == 0.0) { "$key 必须是有限整数" }
    contract(number >= range.first.toDouble() && number <= range.last.toDouble()) { "$key 超出合法范围" }
    return number.toInt()
}

private fun JSONObject.requiredDouble(key: String, minimum: Double, maximum: Double): Double {
    val value = requiredValue(key)
    contract(value is Number) { "$key 必须是数字" }
    val number = (value as Number).toDouble()
    contract(number.isFinite() && number in minimum..maximum) { "$key 超出合法范围" }
    return number
}

private fun JSONObject.requiredPositiveLong(key: String): Long {
    val value = requiredValue(key)
    contract(value is Number) { "$key 必须是整数" }
    val number = (value as Number).toDouble()
    contract(number.isFinite() && number % 1.0 == 0.0 && number in 1.0..Long.MAX_VALUE.toDouble()) {
        "$key 必须是正整数"
    }
    return number.toLong()
}

private inline fun contract(condition: Boolean, detail: () -> String) {
    require(condition) { "分析响应契约无效：${detail()}" }
}

private const val MAX_ITEM_GRAMS = 3_000.0
private const val MAX_FOOD_ITEMS = 12
private const val MAX_ASSUMPTIONS = 30
