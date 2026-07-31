package com.humhum.mobile.ui.theme

import androidx.compose.ui.graphics.Color
import com.humhum.mobile.MobileRoleDashboard
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
}
