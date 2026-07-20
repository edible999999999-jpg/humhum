package com.humhum.mobile.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R

@Composable
fun RolePoster(
    role: MobileRoleDashboard.Role,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit = {},
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(rolePosterHeight(role))
            .clip(RoundedCornerShape(bottomStart = 8.dp, bottomEnd = 8.dp))
            .testTag("role-poster"),
    ) {
        Image(
            painter = painterResource(roomPosterBackgroundFor(role)),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            alignment = posterAlignment(role),
            modifier = Modifier
                .matchParentSize()
                .testTag("role-poster-${role.id()}"),
        )
        if (role == MobileRoleDashboard.Role.HEXA) {
            Image(
                painter = painterResource(R.drawable.room_hexa_character),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .padding(end = 10.dp)
                    .size(182.dp)
                    .testTag("role-poster-character-hexa"),
            )
        }
        content()
    }
}

internal fun rolePosterHeight(role: MobileRoleDashboard.Role): Dp = when (role) {
    MobileRoleDashboard.Role.HUMI -> 242.dp
    MobileRoleDashboard.Role.HYPE -> 236.dp
    MobileRoleDashboard.Role.HUSH -> 240.dp
    MobileRoleDashboard.Role.HEXA -> 244.dp
}

private fun posterAlignment(role: MobileRoleDashboard.Role): Alignment = when (role) {
    MobileRoleDashboard.Role.HUSH -> Alignment.CenterEnd
    else -> Alignment.Center
}
