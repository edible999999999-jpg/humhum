package com.humhum.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R
import com.humhum.mobile.ui.theme.EditorialMetrics
import com.humhum.mobile.ui.theme.editorialSpecFor

object RoleNavigationMetrics {
    val IconSize = 20.dp
    val IndicatorWidth = 24.dp
    val IndicatorHeight = 2.dp
    val ItemGap = 3.dp
    val LabelSize = 9.sp
    val LabelLineHeight = 11.sp
}

@Composable
fun RoleNavigation(
    selected: MobileRoleDashboard.Role,
    onSelect: (MobileRoleDashboard.Role) -> Unit,
    modifier: Modifier = Modifier,
) {
    val spec = editorialSpecFor(selected)
    val divider = if (spec.dark) Color(0xFF3B3F45) else Color(0xFFDFE1DE)
    val background = when (selected) {
        MobileRoleDashboard.Role.HUSH -> Color(0xFFFFFDF9)
        MobileRoleDashboard.Role.HEXA -> Color(0xFF141619)
        else -> Color.White.copy(alpha = 0.92f)
    }
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(EditorialMetrics.BottomNavigationHeight)
            .background(background)
            .drawBehind {
                drawLine(
                    color = divider,
                    start = Offset.Zero,
                    end = Offset(size.width, 0f),
                    strokeWidth = 1.dp.toPx(),
                )
            }
            .testTag("role-navigation"),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MobileRoleDashboard.Role.entries.forEach { role ->
            RoleDestination(
                role = role,
                selected = role == selected,
                dark = spec.dark,
                onClick = { onSelect(role) },
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun RoleDestination(
    role: MobileRoleDashboard.Role,
    selected: Boolean,
    dark: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val activeColor = roleNavigationActiveColor(role)
    val idleColor = if (dark) Color(0xFF747A83) else Color(0xFF7C8088)
    Box(
        modifier = modifier
            .fillMaxHeight()
            .clickable(role = Role.Tab, onClick = onClick)
            .semantics { this.selected = selected }
            .testTag("role-destination")
            .drawBehind {
                if (selected) {
                    val indicatorWidth = RoleNavigationMetrics.IndicatorWidth.toPx()
                    drawRect(
                        color = activeColor,
                        topLeft = Offset((size.width - indicatorWidth) / 2f, 0f),
                        size = Size(
                            indicatorWidth,
                            RoleNavigationMetrics.IndicatorHeight.toPx(),
                        ),
                    )
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(RoleNavigationMetrics.ItemGap),
        ) {
            Icon(
                imageVector = roleIconFor(role),
                contentDescription = null,
                modifier = Modifier.size(RoleNavigationMetrics.IconSize),
                tint = if (selected) activeColor else idleColor,
            )
            Text(
                text = role.displayName(),
                style = MaterialTheme.typography.labelMedium.copy(
                    fontSize = RoleNavigationMetrics.LabelSize,
                    lineHeight = RoleNavigationMetrics.LabelLineHeight,
                    letterSpacing = 0.sp,
                ),
                color = if (selected) activeColor else idleColor,
                maxLines = 1,
            )
        }
    }
}

fun roleIconResourceFor(role: MobileRoleDashboard.Role): Int = when (role) {
    MobileRoleDashboard.Role.HUMI -> R.drawable.ph_sparkle
    MobileRoleDashboard.Role.HYPE -> R.drawable.ph_books
    MobileRoleDashboard.Role.HUSH -> R.drawable.ph_envelope_simple
    MobileRoleDashboard.Role.HEXA -> R.drawable.ph_circuitry
}

fun roleNavigationActiveColor(role: MobileRoleDashboard.Role): Color = when (role) {
    MobileRoleDashboard.Role.HUMI -> Color(0xFF6D5CCC)
    MobileRoleDashboard.Role.HYPE -> Color(0xFFB0462F)
    MobileRoleDashboard.Role.HUSH -> Color(0xFF287864)
    MobileRoleDashboard.Role.HEXA -> Color(0xFFFFC928)
}

@Composable
fun roleIconFor(role: MobileRoleDashboard.Role): ImageVector =
    ImageVector.vectorResource(roleIconResourceFor(role))
