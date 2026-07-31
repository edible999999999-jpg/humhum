package com.humhum.mobile.ui.theme

import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp
import com.humhum.mobile.R
import com.humhum.mobile.MobileRoleDashboard

val Ink = Color(0xFF191B1E)
val Muted = Color(0xFF686B70)
val Canvas = Color(0xFFF8F8F5)
val Line = Color(0xFFDFE1DE)
val Humi = Color(0xFF6D5CCC)
val HumiSoft = Color(0xFFF1EEFF)
val HumiIce = Color(0xFFEDF5FF)
val Hype = Color(0xFFB0462F)
val HypeSoft = Color(0xFFFFEEE8)
val Hush = Color(0xFF287864)
val HushSoft = Color(0xFFE9F7F3)
val HushCanvas = Color(0xFFFFFBF7)
val HushPeach = Color(0xFFFFE7D8)
val HushRose = Color(0xFFF8DDE0)
val HushMintWarm = Color(0xFFE8F5EE)
val Hexa = Color(0xFF8F6508)
val HexaSoft = Color(0xFFFFF5D9)
val HexaPanel = Color(0xFF181A1F)
val HexaPanelRaised = Color(0xFF23262D)
val HexaPanelText = Color(0xFFF7F4E8)
val HexaPanelMuted = Color(0xFFADB2BC)
val HexaSignal = Color(0xFFFFC928)
val Sky = Color(0xFFEDF5FF)
val Attention = Color(0xFFB65022)
val EditorialFocus = Color(0xFF1C1E1D)
val EditorialFocusRaised = Color(0xFF282B29)
val EditorialOnFocus = Color(0xFFF8F6EF)

@OptIn(ExperimentalTextApi::class)
private fun variableFontFamily(fontResource: Int): FontFamily = FontFamily(
    Font(
        resId = fontResource,
        weight = FontWeight.Normal,
        variationSettings = FontVariation.Settings(FontVariation.weight(400)),
    ),
    Font(
        resId = fontResource,
        weight = FontWeight.Medium,
        variationSettings = FontVariation.Settings(FontVariation.weight(500)),
    ),
    Font(
        resId = fontResource,
        weight = FontWeight.SemiBold,
        variationSettings = FontVariation.Settings(FontVariation.weight(600)),
    ),
    Font(
        resId = fontResource,
        weight = FontWeight.Bold,
        variationSettings = FontVariation.Settings(FontVariation.weight(700)),
    ),
)

val HumHumSans = variableFontFamily(R.font.noto_sans_sc)
val HumHumSerif = variableFontFamily(R.font.noto_serif_sc)
val HumHumMono = variableFontFamily(R.font.roboto_mono)

object EditorialMetrics {
    val AppBarHeight = 61.dp
    val BottomNavigationHeight = 70.dp
    val HorizontalPadding = 16.dp
    val ContentTopPadding = 17.dp
    val ContentBottomPadding = 12.dp
}

enum class EditorialLayout {
    MORNING_ISSUE,
    KNOWLEDGE_INDEX,
    CORRESPONDENCE,
    CONTROL_ROOM,
}

data class EditorialRoleSpec(
    val layout: EditorialLayout,
    val canvas: Color,
    val indexLabel: String,
    val dark: Boolean,
)

fun editorialSpecFor(role: MobileRoleDashboard.Role): EditorialRoleSpec = when (role) {
    MobileRoleDashboard.Role.HUMI -> EditorialRoleSpec(
        EditorialLayout.MORNING_ISSUE,
        Color(0xFFFAF9F7),
        "DAILY / 2026",
        false,
    )
    MobileRoleDashboard.Role.HYPE -> EditorialRoleSpec(
        EditorialLayout.KNOWLEDGE_INDEX,
        Color(0xFFFBF7F3),
        "INDEXED",
        false,
    )
    MobileRoleDashboard.Role.HUSH -> EditorialRoleSpec(
        EditorialLayout.CORRESPONDENCE,
        Color(0xFFFFF9F4),
        "待你留意",
        false,
    )
    MobileRoleDashboard.Role.HEXA -> EditorialRoleSpec(
        EditorialLayout.CONTROL_ROOM,
        HexaPanel,
        "MISSION / 01",
        true,
    )
}

val EditorialHero = TextStyle(
    fontFamily = HumHumSerif,
    fontWeight = FontWeight.SemiBold,
    fontSize = 29.sp,
    lineHeight = 36.sp,
    letterSpacing = 0.sp,
)

val EditorialSection = TextStyle(
    fontFamily = HumHumSerif,
    fontWeight = FontWeight.SemiBold,
    fontSize = 20.sp,
    lineHeight = 27.sp,
    letterSpacing = 0.sp,
)

data class RolePalette(val accent: Color, val soft: Color, val companion: Color)

fun paletteFor(role: MobileRoleDashboard.Role): RolePalette = when (role) {
    MobileRoleDashboard.Role.HUMI -> RolePalette(Humi, HumiSoft, HumiIce)
    MobileRoleDashboard.Role.HYPE -> RolePalette(Hype, HypeSoft, Color(0xFFFFF8F2))
    MobileRoleDashboard.Role.HUSH -> RolePalette(Hush, HushSoft, Color(0xFFF5FFFC))
    MobileRoleDashboard.Role.HEXA -> RolePalette(Hexa, HexaSoft, Sky)
}

private val HumHumTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = HumHumSans,
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        lineHeight = 36.sp,
        letterSpacing = 0.sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = HumHumSans,
        fontWeight = FontWeight.Bold,
        fontSize = 23.sp,
        lineHeight = 31.sp,
        letterSpacing = 0.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = HumHumSans,
        fontWeight = FontWeight.Bold,
        fontSize = 18.sp,
        lineHeight = 22.sp,
        letterSpacing = 0.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = HumHumSans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        lineHeight = 19.sp,
        letterSpacing = 0.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = HumHumSans,
        fontSize = 13.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = HumHumSans,
        fontSize = 12.sp,
        lineHeight = 19.sp,
        letterSpacing = 0.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = HumHumSans,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = HumHumSans,
        fontWeight = FontWeight.Medium,
        fontSize = 10.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.sp,
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
