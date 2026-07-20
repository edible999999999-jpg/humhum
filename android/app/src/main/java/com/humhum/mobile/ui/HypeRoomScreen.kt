package com.humhum.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.components.RolePoster
import com.humhum.mobile.ui.theme.Hype
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Muted

@Composable
fun HypeRoomScreen(
    state: HumHumUiState,
    modifier: Modifier = Modifier,
) {
    val context = state.personalContext
    var query by remember { mutableStateOf("") }
    val knowledge = context?.knowledge().orEmpty().filter {
        query.isBlank() ||
            it.title().contains(query, ignoreCase = true) ||
            it.summary().contains(query, ignoreCase = true)
    }
    LazyColumn(
        modifier = modifier.testTag("hype-room"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            RolePoster(MobileRoleDashboard.Role.HYPE) {
                Column(
                    modifier = Modifier
                        .align(Alignment.BottomStart)
                        .padding(horizontal = 20.dp, vertical = 18.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text("本次先整理", style = MaterialTheme.typography.labelLarge, color = Hype)
                    Text(
                        context?.knowledge()?.firstOrNull()?.title() ?: "让知识在下一次直接可用",
                        style = MaterialTheme.typography.headlineMedium,
                        color = Ink,
                        maxLines = 2,
                    )
                }
            }
        }
        item {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it.take(80) },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text("搜索技能与知识") },
                singleLine = true,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier
                    .padding(horizontal = 20.dp)
                    .fillMaxWidth()
                    .testTag("hype-search"),
            )
        }
        item {
            RoomSectionHeader(
                title = "可复用能力",
                trailing = context?.knowledge()?.size?.let { "$it 项" },
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }
        if (knowledge.isEmpty()) {
            item {
                ContextUnavailable(
                    state.personalContextAuthorized,
                    state.personalContextMessage,
                    Modifier.padding(horizontal = 20.dp),
                )
            }
        } else {
            item(key = knowledge.first().id()) {
                RoomItem(
                    title = knowledge.first().title(),
                    detail = "${knowledge.first().summary()} · 来自 Mac 知识库",
                    accent = Hype,
                    meta = if (knowledge.first().kind() == "skill") "Skill" else "笔记",
                    modifier = Modifier
                        .padding(horizontal = 20.dp)
                        .testTag("hype-first-knowledge"),
                )
            }
            items(knowledge.drop(1), key = { it.id() }) { item ->
                RoomItem(
                    title = item.title(),
                    detail = "${item.summary()} · 来自 Mac 知识库",
                    accent = Hype,
                    meta = if (item.kind() == "skill") "Skill" else "笔记",
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }
        }
        item {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RoomSectionHeader(
                    "明确偏好",
                    context?.preferences()?.size?.let { "$it 条" },
                )
                val preferences = context?.preferences().orEmpty()
                if (preferences.isEmpty()) {
                    Text(
                        "尚无已确认偏好。Hype 不会把临时行为自动当成长期规则。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Muted,
                    )
                } else {
                    preferences.forEach { preference ->
                        RoomItem(
                            preference.content(),
                            preference.category(),
                            Hype,
                        )
                    }
                }
            }
        }
        item {
            Column(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                RoomSectionHeader("长期记忆", context?.memories()?.size?.let { "$it 条" })
                context?.memories().orEmpty().forEach { memory ->
                    RoomItem(
                        memory.content(),
                        "记忆温度 · ${memory.temperature()}",
                        Hype,
                    )
                }
                if (context?.memories().isNullOrEmpty()) {
                    Text(
                        "值得跨 Agent 复用的信息，会在你确认后出现在这里。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = Muted,
                    )
                }
            }
        }
    }
}
