package com.humhum.mobile.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(64.dp)
            .background(Color.White)
            .border(width = 1.dp, color = Color(0xFFE8EAF1))
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .testTag("role-navigation"),
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

@Composable
private fun RoleDestination(
    role: MobileRoleDashboard.Role,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = paletteFor(role)
    val shape = RoundedCornerShape(8.dp)
    Column(
        modifier = modifier
            .padding(horizontal = 3.dp)
            .clip(shape)
            .then(if (selected) Modifier.background(palette.soft) else Modifier)
            .clickable(role = Role.Tab, onClick = onClick)
            .semantics { this.selected = selected }
            .testTag("role-destination")
            .padding(vertical = 3.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        RoleMascot(
            role = role,
            contentDescription = null,
            width = 28.dp,
            height = 28.dp,
        )
        Text(
            text = role.displayName(),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = if (selected) palette.accent else Muted,
            maxLines = 1,
        )
    }
}

@DrawableRes
fun mascotFor(role: MobileRoleDashboard.Role): Int = when (role) {
    MobileRoleDashboard.Role.HUMI -> R.drawable.mascot_humi
    MobileRoleDashboard.Role.HYPE -> R.drawable.mascot_hype
    MobileRoleDashboard.Role.HUSH -> R.drawable.mascot_hush
    MobileRoleDashboard.Role.HEXA -> R.drawable.mascot_hexa
}
