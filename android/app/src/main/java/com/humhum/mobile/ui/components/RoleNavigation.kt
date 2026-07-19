package com.humhum.mobile.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountTree
import androidx.compose.material.icons.outlined.AutoStories
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.MarkEmailUnread
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.paletteFor

@Composable
fun RoleNavigation(
    selected: MobileRoleDashboard.Role,
    onSelect: (MobileRoleDashboard.Role) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .height(68.dp)
            .testTag("role-navigation"),
        color = Color.White,
        shadowElevation = 8.dp,
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MobileRoleDashboard.Role.entries.forEach { role ->
                RoleDestination(
                    role = role,
                    selected = role == selected,
                    onClick = { onSelect(role) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun RoleDestination(
    role: MobileRoleDashboard.Role,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = paletteFor(role)
    Column(
        modifier = modifier
            .height(60.dp)
            .clickable(role = Role.Tab, onClick = onClick)
            .semantics(mergeDescendants = true) {
                this.selected = selected
                contentDescription = "${role.displayName()}：${role.purpose()}"
            }
            .testTag("role-destination")
            .padding(horizontal = 4.dp, vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp, Alignment.CenterVertically),
    ) {
        Box(
            Modifier
                .size(width = 24.dp, height = 2.dp)
                .background(if (selected) palette.accent else Color.Transparent),
        )
        Icon(
            imageVector = iconFor(role),
            contentDescription = null,
            tint = if (selected) palette.accent else Muted,
            modifier = Modifier
                .size(23.dp)
                .testTag("role-navigation-icon"),
        )
        Text(
            text = role.displayName(),
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) palette.accent else Muted,
            maxLines = 1,
        )
    }
}

private fun iconFor(role: MobileRoleDashboard.Role): ImageVector = when (role) {
    MobileRoleDashboard.Role.HUMI -> Icons.Outlined.ChatBubbleOutline
    MobileRoleDashboard.Role.HYPE -> Icons.Outlined.AutoStories
    MobileRoleDashboard.Role.HUSH -> Icons.Outlined.MarkEmailUnread
    MobileRoleDashboard.Role.HEXA -> Icons.Outlined.AccountTree
}

@DrawableRes
fun mascotFor(role: MobileRoleDashboard.Role): Int = when (role) {
    MobileRoleDashboard.Role.HUMI -> R.drawable.mascot_humi
    MobileRoleDashboard.Role.HYPE -> R.drawable.mascot_hype
    MobileRoleDashboard.Role.HUSH -> R.drawable.mascot_hush
    MobileRoleDashboard.Role.HEXA -> R.drawable.mascot_hexa
}
