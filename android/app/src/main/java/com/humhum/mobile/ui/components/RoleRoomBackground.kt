package com.humhum.mobile.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R

@Composable
fun RoleRoomBackground(
    role: MobileRoleDashboard.Role,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(modifier.fillMaxSize()) {
        Image(
            painter = painterResource(roomBackgroundFor(role)),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            alignment = if (role == MobileRoleDashboard.Role.HUSH) {
                Alignment.CenterEnd
            } else {
                Alignment.Center
            },
            modifier = Modifier
                .fillMaxSize()
                .alpha(roomBackgroundAlpha(role))
                .testTag("room-background"),
        )
        content()
    }
}

@DrawableRes
fun roomBackgroundFor(role: MobileRoleDashboard.Role): Int = when (role) {
    MobileRoleDashboard.Role.HUMI -> R.drawable.room_humi
    MobileRoleDashboard.Role.HYPE -> R.drawable.room_hype
    MobileRoleDashboard.Role.HUSH -> R.drawable.room_hush
    MobileRoleDashboard.Role.HEXA -> R.drawable.room_hexa
}

private fun roomBackgroundAlpha(role: MobileRoleDashboard.Role): Float = when (role) {
    MobileRoleDashboard.Role.HUMI -> 0.78f
    MobileRoleDashboard.Role.HYPE -> 0.72f
    MobileRoleDashboard.Role.HUSH -> 0.76f
    MobileRoleDashboard.Role.HEXA -> 0.68f
}
