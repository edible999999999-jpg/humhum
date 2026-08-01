package com.humhum.mobile.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R
import com.humhum.mobile.ui.components.RoleNavigationMetrics
import com.humhum.mobile.ui.components.roleIconResourceFor
import com.humhum.mobile.ui.components.roleNavigationActiveColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EditorialRoleSpecTest {
    @Test
    fun everyRoleHasItsOwnEditorialComposition() {
        val specs = MobileRoleDashboard.Role.entries.map(::editorialSpecFor)

        assertEquals(4, specs.map { it.layout }.distinct().size)
        assertEquals(EditorialLayout.MORNING_ISSUE, editorialSpecFor(MobileRoleDashboard.Role.HUMI).layout)
        assertEquals(EditorialLayout.KNOWLEDGE_INDEX, editorialSpecFor(MobileRoleDashboard.Role.HYPE).layout)
        assertEquals(EditorialLayout.CORRESPONDENCE, editorialSpecFor(MobileRoleDashboard.Role.HUSH).layout)
        assertEquals(EditorialLayout.CONTROL_ROOM, editorialSpecFor(MobileRoleDashboard.Role.HEXA).layout)
    }

    @Test
    fun roleSurfacesMatchTheApprovedPreview() {
        val humi = editorialSpecFor(MobileRoleDashboard.Role.HUMI)
        val hype = editorialSpecFor(MobileRoleDashboard.Role.HYPE)
        val hush = editorialSpecFor(MobileRoleDashboard.Role.HUSH)
        val hexa = editorialSpecFor(MobileRoleDashboard.Role.HEXA)

        assertEquals(Color(0xFFFAF9F7), humi.canvas)
        assertEquals("DAILY / 2026", humi.indexLabel)
        assertEquals(Color(0xFFFBF7F3), hype.canvas)
        assertEquals("INDEXED", hype.indexLabel)
        assertEquals(Color(0xFFFFF9F4), hush.canvas)
        assertEquals("待你留意", hush.indexLabel)
        assertEquals(HexaPanel, hexa.canvas)
        assertEquals("MISSION / 01", hexa.indexLabel)

        assertFalse(humi.dark)
        assertFalse(hype.dark)
        assertFalse(hush.dark)
        assertTrue(hexa.dark)
    }

    @Test
    fun typographyAndChromeUseTheApprovedPreviewMetrics() {
        assertEquals(HumHumSerif, EditorialHero.fontFamily)
        assertEquals(HumHumSerif, EditorialSection.fontFamily)
        assertEquals(29.sp, EditorialHero.fontSize)
        assertEquals(36.sp, EditorialHero.lineHeight)
        assertEquals(0.sp, EditorialHero.letterSpacing)
        assertEquals(20.sp, EditorialSection.fontSize)
        assertEquals(27.sp, EditorialSection.lineHeight)
        assertEquals(0.sp, EditorialSection.letterSpacing)
        assertEquals(61.dp, EditorialMetrics.AppBarHeight)
        assertEquals(70.dp, EditorialMetrics.BottomNavigationHeight)
        assertEquals(16.dp, EditorialMetrics.HorizontalPadding)
        assertEquals(17.dp, EditorialMetrics.ContentTopPadding)
    }

    @Test
    fun roleNavigationUsesTheApprovedPhosphorIconsAndMetrics() {
        assertEquals(R.drawable.ph_sparkle, roleIconResourceFor(MobileRoleDashboard.Role.HUMI))
        assertEquals(R.drawable.ph_books, roleIconResourceFor(MobileRoleDashboard.Role.HYPE))
        assertEquals(
            R.drawable.ph_envelope_simple,
            roleIconResourceFor(MobileRoleDashboard.Role.HUSH),
        )
        assertEquals(R.drawable.ph_circuitry, roleIconResourceFor(MobileRoleDashboard.Role.HEXA))
        assertEquals(20.dp, RoleNavigationMetrics.IconSize)
        assertEquals(24.dp, RoleNavigationMetrics.IndicatorWidth)
        assertEquals(2.dp, RoleNavigationMetrics.IndicatorHeight)
        assertEquals(3.dp, RoleNavigationMetrics.ItemGap)
        assertEquals(9.sp, RoleNavigationMetrics.LabelSize)
        assertEquals(11.sp, RoleNavigationMetrics.LabelLineHeight)
        assertEquals(
            Color(0xFFFFC928),
            roleNavigationActiveColor(MobileRoleDashboard.Role.HEXA),
        )
    }
}
