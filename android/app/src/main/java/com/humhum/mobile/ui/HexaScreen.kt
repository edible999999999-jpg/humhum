package com.humhum.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.app.PendingAction
import com.humhum.mobile.app.PendingActionKind
import com.humhum.mobile.ui.theme.Hexa
import com.humhum.mobile.ui.theme.HexaPanel
import com.humhum.mobile.ui.theme.HexaPanelMuted
import com.humhum.mobile.ui.theme.HexaPanelRaised
import com.humhum.mobile.ui.theme.HexaPanelText
import com.humhum.mobile.ui.theme.HexaSignal
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.EditorialHero
import com.humhum.mobile.ui.theme.editorialSpecFor

@Composable
fun HexaScreen(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
) {
    val orderedSessions = remember(state.sessions) {
        state.sessions.sortedWith(
            compareByDescending<Models.Session> { it.needsAttention() }
                .thenByDescending { it.canMessage() }
                .thenByDescending { it.lastActivityAt() },
        )
    }
    LazyColumn(
        modifier = modifier.fillMaxSize().background(HexaPanel).testTag("hexa-room"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 16.dp,
            end = 16.dp,
            top = 14.dp,
            bottom = 20.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    "${editorialSpecFor(MobileRoleDashboard.Role.HEXA).indexLabel} · NOW RUNNING",
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 9.sp,
                    ),
                    color = HexaSignal,
                )
                Text(
                    orderedSessions.firstOrNull()?.project()?.ifBlank { "Agent 会话" }
                        ?: "Agent 会话",
                    style = EditorialHero,
                    color = HexaPanelText,
                )
                Text(
                    if (state.canControl) {
                        "你可以在这里确认权限、查看进展，并继续给 Agent 下达任务。"
                    } else {
                        "只读观察 · 当前电脑没有授予确认和追问权限。"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = HexaPanelMuted,
                )
                MissionStrip(sessionCount = orderedSessions.size)
            }
        }
        if (orderedSessions.isEmpty()) {
            item {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(2.dp),
                    color = HexaPanelRaised,
                    border = androidx.compose.foundation.BorderStroke(1.dp, HexaPanelMuted.copy(alpha = 0.34f)),
                ) {
                    Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("现在很安静", style = MaterialTheme.typography.titleMedium, color = HexaPanelText)
                        Text(
                            "最近没有需要你处理的 Agent 会话。",
                            style = MaterialTheme.typography.bodyMedium,
                            color = HexaPanelMuted,
                        )
                    }
                }
            }
        } else {
            item(key = orderedSessions.first().id()) {
                SessionPanel(
                    session = orderedSessions.first(),
                    state = state,
                    callbacks = callbacks,
                    primary = true,
                )
            }
            if (orderedSessions.size > 1) {
                item {
                    RoomSectionHeader(
                        title = "其他最近会话",
                        trailing = "${orderedSessions.size - 1} 条",
                        dark = true,
                        accent = HexaSignal,
                    )
                }
                items(orderedSessions.drop(1), key = { it.id() }) { session ->
                    SessionPanel(
                        session = session,
                        state = state,
                        callbacks = callbacks,
                    )
                }
            }
        }
        if (!state.personalContext?.agents().isNullOrEmpty()) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    RoomSectionHeader(
                        "正在关注",
                        trailing = "${state.personalContext!!.agents().size} 个 Agent",
                        dark = true,
                        accent = HexaSignal,
                    )
                    state.personalContext!!.agents().take(3).forEach { agent ->
                        RoomItem(
                            title = agent.name(),
                            detail = agent.currentStep() ?: agent.status(),
                            accent = Hexa,
                            meta = if (agent.needsUser()) "需要你" else agent.status(),
                            dark = true,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MissionStrip(sessionCount: Int) {
    Column(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        HorizontalDivider(color = HexaPanelMuted.copy(alpha = 0.3f))
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                "LOCAL RELAY",
                style = MaterialTheme.typography.labelMedium.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 8.sp,
                ),
                color = HexaSignal,
            )
            Text(
                "ENCRYPTED",
                style = MaterialTheme.typography.labelMedium.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 8.sp,
                ),
                color = HexaPanelMuted,
            )
            Text(
                "$sessionCount AGENTS",
                style = MaterialTheme.typography.labelMedium.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 8.sp,
                ),
                color = HexaPanelMuted,
            )
        }
        HorizontalDivider(color = HexaPanelMuted.copy(alpha = 0.3f))
    }
}

@Composable
private fun SessionPanel(
    session: Models.Session,
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
    primary: Boolean = false,
) {
    var draft by remember(session.id()) { mutableStateOf("") }
    var handledSuccessRevision by remember(session.id()) {
        mutableLongStateOf(state.followUpSuccessRevision)
    }
    val followUpPending = PendingAction(PendingActionKind.FOLLOW_UP, session.id()) in state.pendingActions
    LaunchedEffect(state.followUpSuccessRevision, state.lastSuccessfulFollowUpSessionId) {
        if (state.followUpSuccessRevision > handledSuccessRevision &&
            state.lastSuccessfulFollowUpSessionId == session.id()
        ) {
            draft = ""
        }
        handledSuccessRevision = state.followUpSuccessRevision
    }
    val panelColor = if (primary) HexaPanelRaised else HexaPanel
    val raisedColor = if (primary) Color(0xFF292C31) else HexaPanelRaised
    val titleColor = HexaPanelText
    val metadataColor = HexaPanelMuted
    val accentColor = HexaSignal
    val canSend = draft.isNotBlank() && !followUpPending
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .then(if (primary) Modifier.testTag("hexa-primary-session") else Modifier),
        shape = RoundedCornerShape(if (primary) 2.dp else 0.dp),
        color = panelColor,
        border = androidx.compose.foundation.BorderStroke(
            1.dp,
            if (primary) HexaSignal.copy(alpha = 0.78f)
            else HexaPanelMuted.copy(alpha = 0.28f),
        ),
    ) {
        Column(modifier = Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    modifier = Modifier.size(36.dp),
                    color = raisedColor,
                    shape = RoundedCornerShape(8.dp),
                ) {
                    androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Outlined.Terminal,
                            contentDescription = null,
                            modifier = Modifier.size(21.dp),
                            tint = accentColor,
                        )
                    }
                }
                Spacer(Modifier.size(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        session.project().ifBlank { session.agent() },
                        style = MaterialTheme.typography.titleMedium,
                        color = titleColor,
                    )
                    Text(
                        "${session.agent()} · ${session.status()} · ${session.lastActivityAt()}",
                        style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                        color = metadataColor,
                    )
                }
                Text(
                    if (session.needsAttention()) "需要你" else "工作中",
                    style = MaterialTheme.typography.labelMedium,
                    color = if (session.needsAttention()) Color(0xFFFFA7A7) else accentColor,
                )
                if (session.canReadConversation()) {
                    IconButton(onClick = { callbacks.onOpenConversation(session) }, modifier = Modifier.size(48.dp)) {
                        Icon(
                            Icons.Outlined.ChatBubbleOutline,
                            contentDescription = "查看对话",
                            tint = accentColor,
                        )
                    }
                }
            }
            if (primary) {
                Text(
                    if (session.needsAttention()) {
                        "这条会话正在等你处理"
                    } else {
                        "这是最近仍可继续下达任务的会话"
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = HexaPanelText,
                )
                LinearProgressIndicator(
                    progress = { if (session.needsAttention()) 0.52f else 0.72f },
                    modifier = Modifier.fillMaxWidth(),
                    color = HexaSignal,
                    trackColor = HexaPanelRaised,
                )
            }
            if (state.canControl) {
                session.actions().forEach { action ->
                    ActionRow(
                        action = action,
                        enabled = PendingAction(PendingActionKind.APPROVAL, session.id(), action.id()) !in state.pendingActions,
                        onResolve = { approved -> callbacks.onResolve(session, action, approved) },
                        dark = true,
                    )
                }
            }
            if (state.canControl && session.canMessage()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it.take(4000) },
                        label = { Text("追问或补充") },
                        modifier = Modifier.weight(1f).testTag("follow-up-draft"),
                        shape = RoundedCornerShape(8.dp),
                        maxLines = 3,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = HexaPanelText,
                            unfocusedTextColor = HexaPanelText,
                            focusedContainerColor = raisedColor,
                            unfocusedContainerColor = raisedColor,
                            focusedBorderColor = HexaSignal,
                            unfocusedBorderColor = HexaPanelMuted.copy(alpha = 0.58f),
                            cursorColor = HexaSignal,
                            focusedLabelColor = HexaSignal,
                            unfocusedLabelColor = HexaPanelMuted,
                        ),
                    )
                    IconButton(
                        onClick = {
                            val text = draft.trim()
                            if (text.isNotEmpty()) {
                                callbacks.onSendFollowUp(session, text)
                            }
                        },
                        enabled = canSend,
                        colors = IconButtonDefaults.iconButtonColors(
                            contentColor = HexaPanel,
                            disabledContentColor = HexaPanelMuted,
                        ),
                        modifier = Modifier
                            .size(48.dp)
                            .background(
                                color = if (canSend) {
                                    accentColor
                                } else {
                                    raisedColor
                                },
                                shape = RoundedCornerShape(2.dp),
                            ),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Outlined.Send,
                            contentDescription = "发送",
                        )
                    }
                }
                state.followUpFeedback[session.id()]?.let { feedback ->
                    Text(
                        text = feedback,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (feedback.startsWith("电脑已收到")) {
                            metadataColor
                        } else {
                            Color(0xFFFFA7A7)
                        },
                    )
                }
            }
            if (state.conversation.sessionId == session.id()) {
                ConversationDisclosure(
                    state = state,
                    onClose = callbacks.onCloseConversation,
                    dark = true,
                )
            }
        }
    }
}

@Composable
private fun ActionRow(
    action: Models.Action,
    enabled: Boolean,
    onResolve: (Boolean) -> Unit,
    dark: Boolean,
) {
    val textColor = if (dark) HexaPanelText else Ink
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            action.summary().ifBlank { action.operation() },
            style = MaterialTheme.typography.bodyMedium,
            color = textColor,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { onResolve(true) },
                enabled = enabled,
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (dark) HexaSignal else Hexa,
                    contentColor = if (dark) HexaPanel else Color.White,
                ),
                modifier = Modifier.height(48.dp),
            ) { Text("允许") }
            OutlinedButton(
                onClick = { onResolve(false) },
                enabled = enabled,
                shape = RoundedCornerShape(8.dp),
                colors = if (dark) {
                    ButtonDefaults.outlinedButtonColors(contentColor = HexaPanelText)
                } else {
                    ButtonDefaults.outlinedButtonColors()
                },
                border = androidx.compose.foundation.BorderStroke(
                    1.dp,
                    if (dark) HexaPanelMuted else Line,
                ),
                modifier = Modifier.height(48.dp),
            ) { Text("拒绝") }
        }
    }
}

@Composable
private fun ConversationDisclosure(
    state: HumHumUiState,
    onClose: () -> Unit,
    dark: Boolean,
) {
    val titleColor = if (dark) HexaPanelText else Ink
    val secondaryColor = if (dark) HexaPanelMuted else Muted
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable(onClick = onClose).padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("对话内容", style = MaterialTheme.typography.titleMedium, color = titleColor)
            Spacer(Modifier.weight(1f))
            Icon(Icons.Outlined.ChevronRight, contentDescription = "收起", tint = secondaryColor)
        }
        when {
            state.conversation.loading -> CircularProgressIndicator(
                modifier = Modifier.size(22.dp),
                color = if (dark) HexaSignal else Hexa,
                strokeWidth = 2.dp,
            )
            state.conversation.error != null -> Text(state.conversation.error, color = MaterialTheme.colorScheme.error)
            else -> state.conversation.messages.forEach { message ->
                Text(
                    text = "${if (message.role() == Models.ConversationRole.USER) "你" else "Agent"}：${message.text()}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = titleColor,
                )
            }
        }
    }
}
