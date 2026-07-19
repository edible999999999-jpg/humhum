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
import com.humhum.mobile.ui.theme.Hush
import com.humhum.mobile.ui.theme.Muted

@Composable
fun HushRoomScreen(
    state: HumHumUiState,
    modifier: Modifier = Modifier,
) {
    val inbox = state.personalContext?.inbox().orEmpty()
    val priority = inbox.count { it.importance() >= 4 }
    LazyColumn(
        modifier = modifier.testTag("hush-room"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            RoomIntro(
                role = MobileRoleDashboard.Role.HUSH,
                title = "只把真正值得你看见的消息放在前面",
                summary = if (priority == 0) {
                    "现在没有高优先级消息，你可以继续手上的事。"
                } else {
                    "$priority 条消息值得留意，Hush 不会替你偷偷回复。"
                },
            )
        }
        item {
            RoomSectionHeader(
                title = "收件箱",
                trailing = if (inbox.isEmpty()) null else "${inbox.size} 条摘要",
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        if (inbox.isEmpty()) {
            item {
                ContextUnavailable(
                    state.personalContextAuthorized,
                    state.personalContextMessage,
                    Modifier.padding(horizontal = 16.dp),
                )
            }
        } else {
            items(inbox, key = { it.id() }) { message ->
                RoomItem(
                    title = message.sender(),
                    detail = message.preview(),
                    accent = Hush,
                    meta = message.platform(),
                    modifier = Modifier.padding(horizontal = 16.dp),
                )
            }
        }
        item {
            Column(
                modifier = Modifier.padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    "隐私边界",
                    style = MaterialTheme.typography.labelLarge,
                    color = Hush,
                )
                Text(
                    "这里只显示你已授权来源的限量预览，不包含原始消息对象，也不会自动发送回复。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                )
            }
        }
    }
}
