package com.humhum.mobile.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.EditorialSection
import com.humhum.mobile.ui.theme.HexaPanelMuted
import com.humhum.mobile.ui.theme.HexaPanelText
import com.humhum.mobile.ui.theme.paletteFor

@Composable
fun RoomIntro(
    role: MobileRoleDashboard.Role,
    title: String,
    summary: String,
    modifier: Modifier = Modifier,
) {
    val palette = paletteFor(role)
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(palette.soft.copy(alpha = 0.62f))
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Surface(
            modifier = Modifier.size(width = 4.dp, height = 54.dp),
            color = palette.accent,
            shape = RoundedCornerShape(2.dp),
        ) {}
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "${role.displayName()} · ${role.purpose()}",
                style = MaterialTheme.typography.labelMedium,
                color = palette.accent,
            )
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = Ink,
                maxLines = 3,
            )
            Text(
                text = summary,
                style = MaterialTheme.typography.bodyMedium,
                color = Muted,
                maxLines = 3,
            )
        }
    }
}

@Composable
fun RoomSectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
    dark: Boolean = false,
    accent: Color? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            style = EditorialSection,
            color = accent ?: if (dark) HexaPanelText else Ink,
        )
        Spacer(Modifier.weight(1f))
        trailing?.let {
            Text(
                it,
                style = MaterialTheme.typography.labelMedium,
                color = if (dark) HexaPanelMuted else Muted,
            )
        }
    }
}

@Composable
fun RoomItem(
    title: String,
    detail: String,
    accent: Color,
    modifier: Modifier = Modifier,
    meta: String? = null,
    dark: Boolean = false,
) {
    val titleColor = if (dark) HexaPanelText else Ink
    val detailColor = if (dark) HexaPanelMuted else Muted
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Surface(
                modifier = Modifier.size(width = 4.dp, height = 38.dp),
                color = accent,
                shape = RoundedCornerShape(2.dp),
            ) {}
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(title, style = MaterialTheme.typography.titleMedium, color = titleColor, maxLines = 2)
                Text(detail, style = MaterialTheme.typography.bodyMedium, color = detailColor, maxLines = 2)
            }
            meta?.let {
                Text(it, style = MaterialTheme.typography.labelMedium, color = accent, maxLines = 1)
            }
        }
        HorizontalDivider(
            modifier = Modifier.padding(start = 14.dp),
            color = if (dark) HexaPanelMuted.copy(alpha = 0.28f) else Line,
        )
    }
}

@Composable
fun ContextUnavailable(
    authorized: Boolean,
    message: String?,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color.White,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, Line),
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                if (authorized) "这部分暂时没有内容" else "电脑尚未授权这部分信息",
                style = MaterialTheme.typography.titleMedium,
                color = Ink,
            )
            Text(
                message ?: if (authorized) "连接恢复后会自动更新。" else "在 Mac 的 Hexa 配对时开启“同步个人上下文”。",
                style = MaterialTheme.typography.bodyMedium,
                color = Muted,
            )
        }
    }
}
