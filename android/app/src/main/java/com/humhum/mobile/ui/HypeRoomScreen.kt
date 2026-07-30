package com.humhum.mobile.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.ui.theme.Hype
import com.humhum.mobile.ui.theme.HypeSoft
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Muted

@Composable
fun HypeRoomScreen(
    state: HumHumUiState,
    modifier: Modifier = Modifier,
) {
    val context = state.personalContext
    var query by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("最近使用") }
    val knowledge = context?.knowledge().orEmpty()
        .filter {
            query.isBlank() ||
                it.title().contains(query, ignoreCase = true) ||
                it.summary().contains(query, ignoreCase = true)
        }
        .filter { category != "Skills" || it.kind() == "skill" }
    val showKnowledge = category == "最近使用" || category == "Skills"
    val showPreferences = category == "最近使用" || category == "偏好"
    val showMemories = category == "最近使用" || category == "长期记忆"
    LazyColumn(
        modifier = modifier.testTag("hype-room"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 14.dp,
            bottom = 20.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it.take(80) },
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text("搜索技能、偏好与记忆") },
                singleLine = true,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        item {
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("最近使用", "Skills", "偏好", "长期记忆").forEach { label ->
                    FilterChip(
                        selected = category == label,
                        onClick = { category = label },
                        label = { Text(label) },
                        shape = RoundedCornerShape(8.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = HypeSoft,
                            selectedLabelColor = Hype,
                            containerColor = Color.White,
                            labelColor = Muted,
                        ),
                    )
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text("最近最常用", style = MaterialTheme.typography.labelLarge, color = Muted)
                Text("让下一次直接更懂你", style = MaterialTheme.typography.headlineMedium, color = Ink)
                Text(
                    "这里展示整理和确认过的能力，不把文件数量当成价值。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                )
            }
        }
        if (showKnowledge) {
            item {
                RoomSectionHeader(
                    title = "可复用能力",
                    trailing = knowledge.size.let { "$it 项" },
                )
            }
            if (knowledge.isEmpty()) {
                item {
                    ContextUnavailable(
                        state.personalContextAuthorized,
                        state.personalContextMessage,
                    )
                }
            } else {
                items(knowledge, key = { it.id() }) { item ->
                    RoomItem(
                        title = item.title(),
                        detail = item.summary(),
                        accent = Hype,
                        meta = if (item.kind() == "skill") "Skill" else "笔记",
                    )
                }
            }
        }
        if (showPreferences) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
        }
        if (showMemories) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
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
}
