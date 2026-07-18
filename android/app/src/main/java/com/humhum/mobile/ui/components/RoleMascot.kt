package com.humhum.mobile.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard

@Composable
fun RoleMascot(
    role: MobileRoleDashboard.Role,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    width: Dp = 104.dp,
    height: Dp = width,
    zoom: Float = 1.65f,
) {
    Box(
        modifier = modifier.size(width = width, height = height).clipToBounds(),
        contentAlignment = Alignment.Center,
    ) {
        Image(
            painter = painterResource(mascotFor(role)),
            contentDescription = contentDescription,
            modifier = Modifier.fillMaxSize().graphicsLayer(scaleX = zoom, scaleY = zoom),
            contentScale = ContentScale.Fit,
        )
    }
}
