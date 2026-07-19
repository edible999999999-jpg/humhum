package com.humhum.mobile.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R

private val NavigationSurface = Color(0xFFFDFEFF)
private val NavigationIcon = Color(0xFF4C5663)
private val NavigationLabel = Color(0xFF606A76)
private val NavigationLine = Color(0x17604050)

private data class NavigationPalette(
    val active: Color,
    val marker: Color,
    val companionMarker: Color? = null,
    val activeIcon: Color = active,
)

private fun navigationPaletteFor(role: MobileRoleDashboard.Role): NavigationPalette = when (role) {
    MobileRoleDashboard.Role.HUMI -> NavigationPalette(
        active = Color(0xFF298DA8),
        marker = Color(0xFF45A9C2),
    )
    MobileRoleDashboard.Role.HYPE -> NavigationPalette(
        active = Color(0xFFE85D37),
        marker = Color(0xFFF0643F),
        companionMarker = Color(0xFF8F68D8),
    )
    MobileRoleDashboard.Role.HUSH -> NavigationPalette(
        active = Color(0xFF278665),
        marker = Color(0xFF26956D),
        companionMarker = Color(0xFFEB8C3E),
    )
    MobileRoleDashboard.Role.HEXA -> NavigationPalette(
        active = Color(0xFF2779B9),
        marker = Color(0xFF2F86CF),
        companionMarker = Color(0xFFEABF31),
        activeIcon = Color(0xFF111827),
    )
}

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
        color = NavigationSurface,
        shadowElevation = 0.dp,
    ) {
        Column {
            HorizontalDivider(color = NavigationLine)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
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
}

@Composable
private fun RoleDestination(
    role: MobileRoleDashboard.Role,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = navigationPaletteFor(role)
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
        RoleSelectionAccent(selected, palette)
        Box(Modifier.size(23.dp).testTag("role-navigation-icon")) {
            Icon(
                painter = painterResource(iconFor(role)),
                contentDescription = null,
                tint = if (selected) palette.activeIcon else NavigationIcon,
                modifier = Modifier
                    .size(23.dp)
                    .testTag("role-symbol-${symbolNameFor(role)}"),
            )
        }
        Text(
            text = role.displayName(),
            style = MaterialTheme.typography.labelMedium,
            color = if (selected) palette.active else NavigationLabel,
            maxLines = 1,
        )
    }
}

@Composable
private fun RoleSelectionAccent(selected: Boolean, palette: NavigationPalette) {
    Box(Modifier.size(width = 24.dp, height = 4.dp)) {
        if (!selected) return@Box
        Box(
            Modifier
                .width(if (palette.companionMarker == null) 24.dp else 21.dp)
                .height(2.dp)
                .background(palette.marker),
        )
        palette.companionMarker?.let { companion ->
            Box(
                Modifier
                    .width(21.dp)
                    .height(2.dp)
                    .offset(x = 3.dp, y = 2.dp)
                    .background(companion),
            )
        }
    }
}

private fun iconFor(role: MobileRoleDashboard.Role): Int = when (role) {
    MobileRoleDashboard.Role.HUMI -> R.drawable.ic_role_humi_mic_vocal
    MobileRoleDashboard.Role.HYPE -> R.drawable.ic_role_hype_radio_tower
    MobileRoleDashboard.Role.HUSH -> R.drawable.ic_role_hush_eye
    MobileRoleDashboard.Role.HEXA -> R.drawable.ic_role_hexa_wrench
}

private fun symbolNameFor(role: MobileRoleDashboard.Role): String = when (role) {
    MobileRoleDashboard.Role.HUMI -> "mic-2"
    MobileRoleDashboard.Role.HYPE -> "radio-tower"
    MobileRoleDashboard.Role.HUSH -> "eye"
    MobileRoleDashboard.Role.HEXA -> "wrench"
}
