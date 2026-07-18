package com.humhum.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.components.RoleMascot
import com.humhum.mobile.ui.theme.Hype
import com.humhum.mobile.ui.theme.HypeSoft
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted

@Composable
fun HypeScreen(state: HumHumUiState, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RoleMascot(
                role = MobileRoleDashboard.Role.HYPE,
                contentDescription = "Hype",
                width = 104.dp,
                height = 124.dp,
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Text("Hype · 知识与能力", style = MaterialTheme.typography.labelLarge, color = Hype)
                Text("把你的经验整理成下一次可以直接使用的能力", style = MaterialTheme.typography.headlineMedium, color = Ink)
            }
        }
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = HypeSoft,
            shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
            border = androidx.compose.foundation.BorderStroke(1.dp, Hype.copy(alpha = 0.25f)),
        ) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CloudOff, contentDescription = null, tint = Hype)
                    Spacer(Modifier.size(9.dp))
                    Text("等待桌面端知识摘要", style = MaterialTheme.typography.titleMedium, color = Ink)
                }
                Text(
                    "手机版目前不会读取或复制你的原始技能文件。桌面端完成解释后，这里只显示对你有意义的摘要。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                )
            }
        }
        HonestCapabilityRow(
            icon = Icons.Outlined.AutoAwesome,
            title = "常用能力",
            detail = "连接桌面端后显示近期反复使用的工作方式",
        )
        HonestCapabilityRow(
            icon = Icons.Outlined.Memory,
            title = "值得记住",
            detail = if (state.sessions.isEmpty()) "目前没有新的可沉淀线索" else "发现 ${state.sessions.size} 个活跃会话，等待桌面端解释",
        )
    }
}

@Composable
private fun HonestCapabilityRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    detail: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp), color = HypeSoft) {
            Icon(icon, contentDescription = null, tint = Hype, modifier = Modifier.padding(12.dp))
        }
        Spacer(Modifier.size(12.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
            Text(detail, style = MaterialTheme.typography.bodyMedium, color = Muted)
        }
    }
}
