package com.humhum.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.components.RolePoster
import com.humhum.mobile.ui.theme.Hush
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Muted

@Composable
fun HushRoomScreen(
    state: HumHumUiState,
    modifier: Modifier = Modifier,
) {
    val context = state.personalContext
    val contextFreshness = context?.let {
        personalContextFreshness(it.generatedAt(), it.expiresAt())
    }
    val inbox = context?.inbox().orEmpty()
        .sortedByDescending { it.importance() }
    val priority = inbox.count { it.importance() >= 4 }
    LazyColumn(
        modifier = modifier.testTag("hush-room"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            RolePoster(MobileRoleDashboard.Role.HUSH)
        }
        item {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text("Hush 注意到", style = MaterialTheme.typography.labelLarge, color = Hush)
                Text(
                    text = if (contextFreshness?.expired == true && priority > 0) {
                        "旧快照里有 $priority 个人需要留意"
                    } else if (priority == 0) {
                        "今天没有需要你立刻处理的人"
                    } else {
                        "$priority 个人值得你今天回一下"
                    },
                    style = MaterialTheme.typography.headlineMedium,
                    color = Ink,
                    maxLines = 2,
                    modifier = Modifier.testTag("hush-attention"),
                )
                Text(
                    text = if (state.personalContextAuthorized) {
                        "只读摘要 · 已授权来源 · ${contextFreshness?.label ?: "同步时间未知"} · 不会自动发送回复"
                    } else {
                        "尚未授权消息来源 · 不会读取或发送回复"
                    },
                    style = MaterialTheme.typography.labelMedium,
                    color = Muted,
                    modifier = Modifier.testTag("hush-privacy-boundary"),
                )
            }
        }
        item {
            RoomSectionHeader(
                title = "需要回复",
                trailing = if (inbox.isEmpty()) null else "${inbox.size} 条摘要",
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }
        if (inbox.isEmpty()) {
            item {
                ContextUnavailable(
                    state.personalContextAuthorized,
                    state.personalContextMessage,
                    Modifier.padding(horizontal = 20.dp),
                )
            }
        } else {
            item(key = inbox.first().id()) {
                RoomItem(
                    title = inbox.first().sender(),
                    detail = "${inbox.first().preview()} · ${relativeTimestampLabel(inbox.first().receivedAt())}",
                    accent = Hush,
                    meta = inbox.first().platform(),
                    modifier = Modifier
                        .padding(horizontal = 20.dp)
                        .testTag("hush-first-contact"),
                )
            }
            items(inbox.drop(1), key = { it.id() }) { message ->
                RoomItem(
                    title = message.sender(),
                    detail = "${message.preview()} · ${relativeTimestampLabel(message.receivedAt())}",
                    accent = Hush,
                    meta = message.platform(),
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }
        }
        item {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    "隐私边界",
                    style = MaterialTheme.typography.labelLarge,
                    color = Hush,
                )
                Text(
                    "只显示已授权来源的限量预览，不包含原始聊天数据库；建议语气也必须由你主动采用。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                )
            }
        }
    }
}
