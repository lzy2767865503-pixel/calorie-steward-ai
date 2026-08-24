package com.clinicalclarity.app.data.image

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

data class NutritionLabelReadout(
    val rawText: String,
    val energyKcal: Double?,
    val energyBasis: String,
    val servingGrams: Double?,
    val confidence: Double,
)

class NutritionLabelOcr(private val context: Context) {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    suspend fun recognize(file: File): NutritionLabelReadout {
        val input = InputImage.fromFilePath(context, Uri.fromFile(file))
        val result = suspendCancellableCoroutine { continuation ->
            recognizer.process(input)
                .addOnSuccessListener { text ->
                    if (continuation.isActive) continuation.resume(text.text)
                }
                .addOnFailureListener { error ->
                    if (continuation.isActive) continuation.resumeWithException(error)
                }
                .addOnCanceledListener { continuation.cancel() }
        }
        return parse(result)
    }

    internal fun parse(rawText: String): NutritionLabelReadout {
        val normalized = rawText
            .replace(',', '.')
            .replace(Regex("[\\t ]+"), " ")

        val serving = SERVING_PATTERNS.firstNotNullOfOrNull { pattern ->
            pattern.find(normalized)?.groupValues?.getOrNull(1)?.toDoubleOrNull()
        }
        val per100Match = PER_100_KCAL.find(normalized)
        val genericMatch = GENERIC_KCAL.find(normalized)
        val kcalMatch = per100Match ?: genericMatch
        val kcal = kcalMatch?.groupValues
            ?.drop(1)
            ?.firstNotNullOfOrNull { it.takeIf(String::isNotBlank)?.toDoubleOrNull() }
        val basis = if (per100Match != null || normalized.contains("per 100", ignoreCase = true) ||
            normalized.contains("每100", ignoreCase = true)
        ) "100g" else "serving"
        val confidence = when {
            kcal != null && serving != null && per100Match != null -> 0.86
            kcal != null && (serving != null || per100Match != null) -> 0.75
            kcal != null -> 0.62
            else -> 0.0
        }
        return NutritionLabelReadout(
            rawText = rawText,
            energyKcal = kcal,
            energyBasis = basis,
            servingGrams = serving,
            confidence = confidence,
        )
    }

    private companion object {
        val SERVING_PATTERNS = listOf(
            Regex("(?i)(?:serving size|per serving|saiz hidangan)[^0-9]{0,18}(\\d+(?:\\.\\d+)?)\\s*g"),
            Regex("(?:每份|份量|食用份量)[^0-9]{0,12}(\\d+(?:\\.\\d+)?)\\s*(?:g|克)", RegexOption.IGNORE_CASE),
        )
        val PER_100_KCAL = Regex(
            "(?is)(?:per\\s*100\\s*g|每\\s*100\\s*(?:g|克)).{0,100}?(\\d+(?:\\.\\d+)?)\\s*kcal|" +
                "(\\d+(?:\\.\\d+)?)\\s*kcal.{0,100}?(?:per\\s*100\\s*g|每\\s*100\\s*(?:g|克))",
        )
        val GENERIC_KCAL = Regex("(?i)(?:energy|calories|能量|热量)?[^0-9]{0,20}(\\d+(?:\\.\\d+)?)\\s*kcal")
    }
}
