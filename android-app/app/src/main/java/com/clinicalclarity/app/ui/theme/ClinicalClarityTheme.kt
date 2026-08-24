package com.clinicalclarity.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val ClinicalNavy = Color(0xFF082B5C)
val ClinicalNavyStrong = Color(0xFF041E42)
val ClinicalTeal = Color(0xFF0B8AA3)
val ClinicalSuccess = Color(0xFF117A65)
val ClinicalMuted = Color(0xFF667085)
val ClinicalLine = Color(0xFFE4E7EC)
val ClinicalSoft = Color(0xFFF8FAFC)
val ClinicalWarning = Color(0xFF9A4D00)
val ClinicalWarningSoft = Color(0xFFFFF4E5)

private val ClinicalColorScheme = lightColorScheme(
    primary = ClinicalNavy,
    onPrimary = Color.White,
    secondary = ClinicalTeal,
    onSecondary = Color.White,
    background = Color.White,
    onBackground = ClinicalNavyStrong,
    surface = Color.White,
    onSurface = ClinicalNavyStrong,
    surfaceVariant = ClinicalSoft,
    onSurfaceVariant = ClinicalMuted,
    outline = ClinicalLine,
    error = Color(0xFFB42318),
)

@Composable
fun ClinicalClarityTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = ClinicalColorScheme,
        typography = MaterialTheme.typography,
        content = content,
    )
}
