package com.humhum.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.drawBehind
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.PersonOutline
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.EditorialMetrics
import com.humhum.mobile.ui.theme.HexaPanelMuted
import com.humhum.mobile.ui.theme.paletteFor
import com.humhum.mobile.ui.theme.editorialSpecFor

@Composable
fun RoleNavigation(
    selected: MobileRoleDashboard.Role,
    onSelect: (MobileRoleDashboard.Role) -> Unit,
    modifier: Modifier = Modifier,
) {
    val spec = editorialSpecFor(selected)
    val divider = if (spec.dark) HexaPanelMuted.copy(alpha = 0.34f) else Color(0xFFE1E5EC)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(EditorialMetrics.BottomNavigationHeight)
            .background(spec.canvas)
            .drawBehind {
                drawLine(
                    color = divider,
                    start = Offset.Zero,
                    end = Offset(size.width, 0f),
                    strokeWidth = 1.dp.toPx(),
                )
            }
            .padding(horizontal = 8.dp, vertical = 6.dp)
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
    val palette = paletteFor(role)
    val idleColor = if (dark) HexaPanelMuted.copy(alpha = 0.62f) else Muted
    Column(
        modifier = modifier
            .padding(horizontal = 3.dp)
            .clickable(role = Role.Tab, onClick = onClick)
            .semantics { this.selected = selected }
            .testTag("role-destination")
            .padding(vertical = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(
            Modifier
                .width(24.dp)
                .height(2.dp)
                .background(if (selected) palette.accent else Color.Transparent),
        )
        Spacer(Modifier.height(3.dp))
        Icon(
            imageVector = roleIconFor(role),
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = if (selected) palette.accent else idleColor,
        )
        Text(
            text = role.displayName(),
            style = MaterialTheme.typography.labelMedium.copy(
                fontSize = 9.sp,
                lineHeight = 13.sp,
                letterSpacing = 0.sp,
            ),
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) palette.accent else idleColor,
            maxLines = 1,
        )
    }
}

fun roleIconFor(role: MobileRoleDashboard.Role): ImageVector = when (role) {
    MobileRoleDashboard.Role.HUMI -> Icons.Outlined.PersonOutline
    MobileRoleDashboard.Role.HYPE -> Icons.Outlined.AutoStories
    MobileRoleDashboard.Role.HUSH -> Icons.Outlined.Inbox
    MobileRoleDashboard.Role.HEXA -> Icons.Outlined.AccountTree
}
