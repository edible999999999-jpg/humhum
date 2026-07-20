package com.humhum.mobile.ui.components

import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import org.junit.Assert.assertTrue
import org.junit.Test

class RolePosterTest {
    @Test
    fun everyRoleUsesACompactPosterInsteadOfAFullPageBackdrop() {
        MobileRoleDashboard.Role.entries.forEach { role ->
            assertTrue(
                "role=$role height=${rolePosterHeight(role)}",
                rolePosterHeight(role) in 230.dp..250.dp,
            )
        }
    }
}
