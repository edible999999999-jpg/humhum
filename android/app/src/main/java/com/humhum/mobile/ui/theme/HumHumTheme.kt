package com.humhum.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R

val Ink = Color(0xFF1E2B3D)
val Muted = Color(0xFF596579)
val Canvas = Color(0xFFFAFCFF)
val Line = Color(0xFFE3E8F0)
val Humi = Color(0xFF6657B8)
val HumiSoft = Color(0xFFF1EEFF)
val HumiIce = Color(0xFFEAF6FF)
val Hype = Color(0xFFB44A34)
val HypeSoft = Color(0xFFFFF0E9)
val Hush = Color(0xFF287765)
val HushSoft = Color(0xFFEAF8F4)
val Hexa = Color(0xFF80620F)
val HexaSoft = Color(0xFFFFF7DE)
val Sky = Color(0xFFEAF6FF)
val Attention = Color(0xFFB75D12)

data class RolePalette(val accent: Color, val soft: Color, val companion: Color)

fun paletteFor(role: MobileRoleDashboard.Role): RolePalette = when (role) {
    MobileRoleDashboard.Role.HUMI -> RolePalette(Humi, HumiSoft, HumiIce)
    MobileRoleDashboard.Role.HYPE -> RolePalette(Hype, HypeSoft, Color(0xFFFFF8F2))
    MobileRoleDashboard.Role.HUSH -> RolePalette(Hush, HushSoft, Color(0xFFF5FFFC))
    MobileRoleDashboard.Role.HEXA -> RolePalette(Hexa, HexaSoft, Sky)
}

@OptIn(ExperimentalTextApi::class)
val HumHumFontFamily = FontFamily(
    Font(
        R.font.noto_sans_sc,
        FontWeight.Normal,
        variationSettings = FontVariation.Settings(FontVariation.weight(400)),
    ),
    Font(
        R.font.noto_sans_sc,
        FontWeight.Medium,
        variationSettings = FontVariation.Settings(FontVariation.weight(500)),
    ),
    Font(
        R.font.noto_sans_sc,
        FontWeight.SemiBold,
        variationSettings = FontVariation.Settings(FontVariation.weight(600)),
    ),
)

private val NoExtraFontPadding = PlatformTextStyle(includeFontPadding = false)

private fun productTextStyle(
    weight: FontWeight,
    size: TextUnit,
    lineHeight: TextUnit,
) = TextStyle(
    fontFamily = HumHumFontFamily,
    fontWeight = weight,
    fontSize = size,
    lineHeight = lineHeight,
    letterSpacing = 0.sp,
    platformStyle = NoExtraFontPadding,
)

internal val HeadlineNumberStyle = productTextStyle(
    FontWeight.SemiBold,
    17.sp,
    22.sp,
).copy(fontFeatureSettings = "tnum")

internal val HumHumTypography = Typography(
    displaySmall = productTextStyle(FontWeight.SemiBold, 30.sp, 38.sp),
    headlineMedium = productTextStyle(FontWeight.SemiBold, 22.sp, 30.sp),
    titleLarge = productTextStyle(FontWeight.SemiBold, 17.sp, 24.sp),
    titleMedium = productTextStyle(FontWeight.Medium, 16.sp, 23.sp),
    bodyLarge = productTextStyle(FontWeight.Normal, 15.sp, 23.sp),
    bodyMedium = productTextStyle(FontWeight.Normal, 15.sp, 23.sp),
    labelLarge = productTextStyle(FontWeight.Medium, 13.sp, 19.sp),
    labelMedium = productTextStyle(FontWeight.Medium, 12.sp, 16.sp),
)

@Composable
fun HumHumTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Humi,
            onPrimary = Color.White,
            secondary = Hush,
            background = Canvas,
            onBackground = Ink,
            surface = Color.White,
            onSurface = Ink,
            outline = Line,
            error = Color(0xFFB44A4A),
        ),
        typography = HumHumTypography,
        content = content,
    )
}
