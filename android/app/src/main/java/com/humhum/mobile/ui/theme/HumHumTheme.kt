package com.humhum.mobile.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import com.humhum.mobile.MobileRoleDashboard

val Ink = Color(0xFF243247)
val Muted = Color(0xFF6C7890)
val Canvas = Color(0xFFFAFCFF)
val Line = Color(0xFFE3E8F0)
val Humi = Color(0xFF8174D6)
val HumiSoft = Color(0xFFF1EEFF)
val HumiIce = Color(0xFFEAF6FF)
val Hype = Color(0xFFEE7B62)
val HypeSoft = Color(0xFFFFF0E9)
val Hush = Color(0xFF4FAF98)
val HushSoft = Color(0xFFEAF8F4)
val Hexa = Color(0xFFC89A24)
val HexaSoft = Color(0xFFFFF7DE)
val Sky = Color(0xFFEAF6FF)
val Attention = Color(0xFFE9892D)

data class RolePalette(val accent: Color, val soft: Color, val companion: Color)

fun paletteFor(role: MobileRoleDashboard.Role): RolePalette = when (role) {
    MobileRoleDashboard.Role.HUMI -> RolePalette(Humi, HumiSoft, HumiIce)
    MobileRoleDashboard.Role.HYPE -> RolePalette(Hype, HypeSoft, Color(0xFFFFF8F2))
    MobileRoleDashboard.Role.HUSH -> RolePalette(Hush, HushSoft, Color(0xFFF5FFFC))
    MobileRoleDashboard.Role.HEXA -> RolePalette(Hexa, HexaSoft, Sky)
}

private val HumHumTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 30.sp,
        lineHeight = 38.sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 32.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 28.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 16.sp,
        lineHeight = 23.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 16.sp,
        lineHeight = 25.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 14.sp,
        lineHeight = 21.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 17.sp,
    ),
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
