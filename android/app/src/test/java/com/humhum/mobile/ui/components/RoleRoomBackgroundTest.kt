package com.humhum.mobile.ui.components

import com.humhum.mobile.MobileRoleDashboard
import org.junit.Assert.assertEquals
import org.junit.Test

class RoleRoomBackgroundTest {
    @Test
    fun roomBackgroundOpacityMatchesMacCharacterRooms() {
        assertEquals(0.74f, roomBackgroundAlpha(MobileRoleDashboard.Role.HUMI))
        assertEquals(0.46f, roomBackgroundAlpha(MobileRoleDashboard.Role.HYPE))
        assertEquals(0.58f, roomBackgroundAlpha(MobileRoleDashboard.Role.HUSH))
        assertEquals(0.70f, roomBackgroundAlpha(MobileRoleDashboard.Role.HEXA))
    }
}
