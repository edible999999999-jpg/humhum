package com.humhum.mobile.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.annotation.StringRes
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.R
import com.humhum.mobile.Models
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.app.resolve
import com.humhum.mobile.ui.theme.EditorialFocus
import com.humhum.mobile.ui.theme.EditorialHero
import com.humhum.mobile.ui.theme.EditorialMetrics
import com.humhum.mobile.ui.theme.EditorialOnFocus
import com.humhum.mobile.ui.theme.EditorialSection
import com.humhum.mobile.ui.theme.Hype
import com.humhum.mobile.ui.theme.HypeSoft
import com.humhum.mobile.ui.theme.HumHumMono
import com.humhum.mobile.ui.theme.HumHumSerif
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.editorialSpecFor

private enum class HypeCategory(@StringRes val labelRes: Int) {
    RECENT(R.string.hype_category_recent),
    SKILLS(R.string.hype_category_skills),
    PREFERENCES(R.string.hype_category_preferences),
    MEMORIES(R.string.hype_category_memories),
}

@Composable
fun HypeRoomScreen(
    state: HumHumUiState,
    searchVisible: Boolean = false,
    modifier: Modifier = Modifier,
) {
    val context = state.personalContext
    var query by remember { mutableStateOf("") }
    var category by remember { mutableStateOf(HypeCategory.RECENT) }
    val allKnowledge = context?.knowledge().orEmpty()
    val knowledge = allKnowledge
        .filter {
            query.isBlank() ||
                it.title().contains(query, ignoreCase = true) ||
                it.summary().contains(query, ignoreCase = true)
        }
        .filter { category != HypeCategory.SKILLS || it.kind() == "skill" }
    val showKnowledge = category == HypeCategory.RECENT || category == HypeCategory.SKILLS
    val showPreferences = category == HypeCategory.RECENT || category == HypeCategory.PREFERENCES
    val showMemories = category == HypeCategory.RECENT || category == HypeCategory.MEMORIES
    val indexedCount = allKnowledge.size +
        context?.preferences().orEmpty().size +
        context?.memories().orEmpty().size

    LazyColumn(
        modifier = modifier.testTag("hype-room"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = EditorialMetrics.HorizontalPadding,
            end = EditorialMetrics.HorizontalPadding,
            top = EditorialMetrics.ContentTopPadding,
            bottom = EditorialMetrics.ContentBottomPadding,
        ),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            HypeHero(indexedCount)
        }
        item {
            EditorialCategoryTabs(
                selected = category,
                onSelect = { category = it },
            )
        }
        if (searchVisible) {
            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it.take(80) },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    placeholder = { Text(stringResource(R.string.hype_search_placeholder)) },
                    singleLine = true,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth().testTag("hype-search-field"),
                )
            }
        }
        if (category == HypeCategory.RECENT) {
            context?.preferences()?.firstOrNull()?.let { preference ->
                item {
                    HypeFocusPreference(preference)
                }
            }
        }
        if (showKnowledge) {
            item {
                RoomSectionHeader(
                    title = stringResource(R.string.hype_reusable_skills),
                    trailing = stringResource(R.string.hype_count_items, knowledge.size),
                )
            }
            if (knowledge.isEmpty()) {
                item {
                    ContextUnavailable(
                        state.personalContextAuthorized,
                        state.personalContextMessage?.resolve(),
                    )
                }
            } else {
                items(knowledge, key = { it.id() }) { item ->
                    RoomItem(
                        title = item.title(),
                        detail = item.summary(),
                        accent = Hype,
                        meta = if (item.kind() == "skill") stringResource(R.string.hype_meta_skill) else stringResource(R.string.hype_meta_note),
                    )
                }
            }
        }
        if (showPreferences) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    RoomSectionHeader(
                        stringResource(R.string.hype_explicit_preferences),
                        trailing = context?.preferences()?.size?.let { stringResource(R.string.hype_count_entries, it) },
                    )
                    val preferences = context?.preferences().orEmpty()
                    if (preferences.isEmpty()) {
                        Text(
                            stringResource(R.string.hype_no_preferences),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Muted,
                        )
                    } else {
                        preferences
                            .drop(if (category == HypeCategory.RECENT) 1 else 0)
                            .forEach { preference ->
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
                    RoomSectionHeader(
                        stringResource(R.string.hype_long_term_memory),
                        trailing = context?.memories()?.size?.let { stringResource(R.string.hype_count_entries, it) },
                    )
                    context?.memories().orEmpty().forEach { memory ->
                        RoomItem(
                            memory.content(),
                            stringResource(R.string.hype_memory_temperature, memory.temperature()),
                            Hype,
                        )
                    }
                    if (context?.memories().isNullOrEmpty()) {
                        Text(
                            stringResource(R.string.hype_no_memories),
                            style = MaterialTheme.typography.bodyMedium,
                            color = Muted,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HypeHero(indexedCount: Int) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Text(stringResource(R.string.hype_hero_recent), style = MaterialTheme.typography.labelLarge, color = Muted)
            Text(stringResource(R.string.hype_hero_title), style = EditorialHero, color = Ink)
            Text(
                stringResource(R.string.hype_hero_detail),
                style = MaterialTheme.typography.bodyMedium,
                color = Muted,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                indexedCount.toString().padStart(2, '0'),
                style = MaterialTheme.typography.displaySmall.copy(
                    fontFamily = HumHumSerif,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 48.sp,
                    lineHeight = 43.sp,
                ),
                color = Hype,
            )
            HorizontalDivider(modifier = Modifier.width(58.dp), thickness = 2.dp, color = Hype)
            Text(
                editorialSpecFor(MobileRoleDashboard.Role.HYPE).indexLabel,
                style = MaterialTheme.typography.labelMedium.copy(
                    fontFamily = HumHumMono,
                    fontSize = 8.sp,
                ),
                color = Hype,
                modifier = Modifier.padding(top = 5.dp),
            )
        }
    }
}

@Composable
private fun EditorialCategoryTabs(
    selected: HypeCategory,
    onSelect: (HypeCategory) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        HypeCategory.entries.forEach { item ->
            Column(
                modifier = Modifier.clickable { onSelect(item) }.padding(top = 3.dp),
                horizontalAlignment = Alignment.Start,
            ) {
                Text(
                    stringResource(item.labelRes),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (selected == item) Ink else Muted,
                    fontWeight = if (selected == item) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
                HorizontalDivider(
                    thickness = 2.dp,
                    color = if (selected == item) Hype else Color.Transparent,
                )
            }
        }
    }
}

@Composable
private fun HypeFocusPreference(preference: Models.Preference) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = EditorialFocus,
        shape = RoundedCornerShape(8.dp),
        border = BorderStroke(1.dp, Hype.copy(alpha = 0.34f)),
    ) {
        Column(
            modifier = Modifier.padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            Text(stringResource(R.string.hype_explicit_preferences), style = MaterialTheme.typography.labelMedium, color = HypeSoft)
            Text(preference.content(), style = EditorialSection, color = EditorialOnFocus)
            Text(
                preference.category(),
                style = MaterialTheme.typography.bodyMedium,
                color = Color(0xFFC8CBC7),
            )
        }
    }
}
