package com.humhum.mobile.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.humhum.mobile.Models
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.theme.Hush
import com.humhum.mobile.ui.theme.HushSoft
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted

private enum class InboxFilter(val label: String) {
    ALL("全部"),
    REPLY("需要回复"),
    FOCUSED("特别关注"),
}

@Composable
fun HushRoomScreen(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
) {
    val inbox = state.personalContext?.inbox().orEmpty()
    var filter by remember { mutableStateOf(InboxFilter.ALL) }
    val visible = when (filter) {
        InboxFilter.ALL -> inbox
        InboxFilter.REPLY -> inbox.filter { it.importance() >= 4 }
        InboxFilter.FOCUSED -> inbox.filter { it.importance() >= 5 }
    }
    LazyColumn(
        modifier = modifier.testTag("hush-room"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 14.dp,
            bottom = 20.dp,
        ),
    ) {
        item {
            InboxFilterBar(
                selected = filter,
                onSelect = { filter = it },
            )
            Spacer(Modifier.size(20.dp))
        }
        item {
            RoomSectionHeader(
                title = "最近消息",
                trailing = if (inbox.isEmpty()) null else "${inbox.size} 条脱敏摘要",
            )
            Spacer(Modifier.size(7.dp))
        }
        state.personalContextMessage?.let { message ->
            item {
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(bottom = 10.dp),
                )
            }
        }
        if (visible.isEmpty()) {
            item {
                ContextUnavailable(
                    state.personalContextAuthorized,
                    state.personalContextMessage,
                )
            }
        } else {
            items(visible, key = { it.id() }) { message ->
                InboxMessageRow(message)
                HorizontalDivider(color = Line)
            }
        }
        item {
            PrivacyStrip(
                text = "消息正文仅在你的设备与已授权电脑之间加密传输",
                modifier = Modifier.padding(top = 18.dp),
            )
        }
    }
}

@Composable
private fun InboxFilterBar(
    selected: InboxFilter,
    onSelect: (InboxFilter) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color(0xFFF0F2F7),
        shape = RoundedCornerShape(8.dp),
    ) {
        Row(modifier = Modifier.padding(3.dp)) {
            InboxFilter.entries.forEach { item ->
                Surface(
                    modifier = Modifier
                        .weight(1f)
                        .clickable { onSelect(item) },
                    color = if (item == selected) Color.White else Color.Transparent,
                    shape = RoundedCornerShape(6.dp),
                ) {
                    Box(
                        modifier = Modifier.padding(vertical = 9.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            item.label,
                            style = MaterialTheme.typography.labelMedium,
                            color = if (item == selected) Hush else Muted,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun InboxMessageRow(message: Models.InboxItem) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 13.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        Surface(
            modifier = Modifier.size(40.dp),
            shape = RoundedCornerShape(8.dp),
            color = HushSoft,
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(
                    messageInitial(message.sender()),
                    style = MaterialTheme.typography.labelLarge,
                    color = Hush,
                )
            }
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    message.sender(),
                    style = MaterialTheme.typography.titleMedium,
                    color = Ink,
                    maxLines = 1,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    message.receivedAt().substringAfter("T").take(5),
                    style = MaterialTheme.typography.labelMedium,
                    color = Muted,
                )
                if (message.importance() >= 4) {
                    Spacer(Modifier.size(6.dp))
                    Surface(
                        modifier = Modifier.size(7.dp),
                        shape = RoundedCornerShape(4.dp),
                        color = Hush,
                    ) {}
                }
            }
            Text(
                message.preview(),
                style = MaterialTheme.typography.bodyMedium,
                color = Muted,
                maxLines = 2,
            )
            Text(
                message.platform(),
                style = MaterialTheme.typography.labelMedium,
                color = Hush,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun PrivacyStrip(text: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(
            Icons.Outlined.Shield,
            contentDescription = null,
            modifier = Modifier.size(21.dp),
            tint = Color(0xFF8FA0B6),
        )
        Text(text, style = MaterialTheme.typography.labelMedium, color = Muted)
    }
}

private fun messageInitial(sender: String): String {
    val trimmed = sender.trim()
    return when {
        trimmed.isEmpty() -> "讯"
        trimmed.first().code > 127 -> trimmed.takeLast(1)
        else -> trimmed.take(1).uppercase()
    }
}
