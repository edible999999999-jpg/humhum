package com.humhum.mobile.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertTrue
import org.junit.Test

class HumHumThemeTest {
    @Test
    fun mobileTypographyUsesTheDeclaredCjkHierarchy() {
        assertTrue(HumHumTypography.headlineMedium.fontSize.value == 22f)
        assertTrue(HumHumTypography.headlineMedium.lineHeight.value == 30f)
        assertTrue(HumHumTypography.titleLarge.fontSize.value == 17f)
        assertTrue(HumHumTypography.titleMedium.fontSize.value == 16f)
        assertTrue(HumHumTypography.bodyMedium.fontSize.value == 15f)
        assertTrue(HumHumTypography.labelMedium.fontSize.value == 12f)
        assertTrue(HumHumTypography.bodyMedium.letterSpacing.value == 0f)
        assertTrue(HeadlineNumberStyle.fontFeatureSettings == "tnum")
    }

    @Test
    fun roleAccentsMeetWcagAaAgainstWhite() {
        val pairs = mapOf(
            "Humi/white" to (Humi to Color.White),
            "Hype/white" to (Hype to Color.White),
            "Hush/white" to (Hush to Color.White),
            "Hexa/white" to (Hexa to Color.White),
            "Attention/white" to (Attention to Color.White),
            "Muted/white" to (Muted to Color.White),
            "Humi/soft" to (Humi to HumiSoft),
            "Hype/soft" to (Hype to HypeSoft),
            "Hush/soft" to (Hush to HushSoft),
            "Hexa/soft" to (Hexa to HexaSoft),
        )

        pairs.forEach { (name, colors) ->
            val ratio = contrastRatio(colors.first, colors.second)
            assertTrue("$name contrast was $ratio", ratio >= 4.5)
        }
    }

    private fun contrastRatio(foreground: Color, background: Color): Double {
        val lighter = maxOf(luminance(foreground), luminance(background))
        val darker = minOf(luminance(foreground), luminance(background))
        return (lighter + 0.05) / (darker + 0.05)
    }

    private fun luminance(color: Color): Double {
        fun linear(channel: Float): Double {
            val value = channel.toDouble()
            return if (value <= 0.04045) value / 12.92 else Math.pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linear(color.red) +
            0.7152 * linear(color.green) +
            0.0722 * linear(color.blue)
    }
}
