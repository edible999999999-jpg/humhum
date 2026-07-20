package com.humhum.mobile.ui

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.unit.dp
import com.humhum.mobile.Models
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.app.PendingAction
import com.humhum.mobile.app.PendingActionKind
import com.humhum.mobile.ui.components.RolePoster
import com.humhum.mobile.ui.theme.Hexa
import com.humhum.mobile.ui.theme.HexaSoft
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted

@Composable
fun HexaScreen(
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
) {
    val decisions = state.sessions.flatMap { session ->
        session.actions().map { action -> session to action }
    }
    LazyColumn(
        modifier = modifier.fillMaxSize().testTag("hexa-room"),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            RolePoster(MobileRoleDashboard.Role.HEXA) {
                Column(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .padding(start = 20.dp)
                        .widthIn(max = 166.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text("监督模式", style = MaterialTheme.typography.labelLarge, color = Hexa)
                    Text(
                        "先处理需要你决定的事",
                        style = MaterialTheme.typography.headlineMedium,
                        color = Ink,
                        maxLines = 3,
                    )
                }
            }
        }
        item {
            Text(
                text = if (state.canControl) {
                    if (state.canActOnSessions) {
                        "控制权限 · 可以确认和追问"
                    } else {
                        "离线快照 · 等待 Mac 在线后再确认或追问"
                    }
                } else {
                    "只读观察 · 不会替你执行操作"
                },
                style = MaterialTheme.typography.labelLarge,
                color = if (state.canActOnSessions) Hexa else Muted,
                modifier = Modifier
                    .padding(horizontal = 20.dp)
                    .testTag("hexa-permission"),
            )
        }
        item {
            HexaDecisionSection(
                decisions = decisions,
                state = state,
                callbacks = callbacks,
                modifier = Modifier.padding(horizontal = 20.dp),
            )
        }
        if (!state.personalContext?.agents().isNullOrEmpty()) {
            item {
                Column(
                    modifier = Modifier.padding(horizontal = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    RoomSectionHeader(
                        "正在关注",
                        "${state.personalContext!!.agents().size} 个 Agent",
                    )
                    state.personalContext!!.agents().take(3).forEach { agent ->
                        RoomItem(
                            title = agent.name(),
                            detail = "${agent.currentStep() ?: agent.status()} · ${relativeTimestampLabel(agent.updatedAt())}",
                            accent = Hexa,
                            meta = if (agent.needsUser()) "需要你" else agent.status(),
                        )
                    }
                }
            }
        }
        item {
            Row(
                modifier = Modifier.padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Agent 会话", style = MaterialTheme.typography.titleLarge, color = Ink)
                Spacer(Modifier.weight(1f))
                IconButton(onClick = callbacks.onRefresh, modifier = Modifier.size(48.dp)) {
                    if (state.refreshInFlight) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = Hexa)
                    } else {
                        Icon(Icons.Outlined.Refresh, contentDescription = "刷新", tint = Hexa)
                    }
                }
            }
        }
        if (state.sessions.isEmpty()) {
            item {
                Surface(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                    shape = RoundedCornerShape(8.dp),
                    color = HexaSoft,
                    border = androidx.compose.foundation.BorderStroke(1.dp, Hexa.copy(alpha = 0.25f)),
                ) {
                    Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("现在很安静", style = MaterialTheme.typography.titleMedium, color = Ink)
                        Text("最近没有需要你处理的 Agent 会话。", style = MaterialTheme.typography.bodyMedium, color = Muted)
                    }
                }
            }
        } else {
            items(state.sessions, key = { it.id() }) { session ->
                SessionPanel(
                    session = session,
                    state = state,
                    callbacks = callbacks,
                    showActions = false,
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
            }
        }
    }
}

@Composable
private fun HexaDecisionSection(
    decisions: List<Pair<Models.Session, Models.Action>>,
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .testTag("hexa-decision-section"),
        shape = RoundedCornerShape(8.dp),
        color = HexaSoft,
        border = androidx.compose.foundation.BorderStroke(1.dp, Hexa.copy(alpha = 0.28f)),
    ) {
        Column(
            modifier = Modifier.padding(15.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = when {
                    decisions.isEmpty() -> "没有等待你确认的动作"
                    decisions.size == 1 -> "1 件事需要你决定"
                    else -> "${decisions.size} 件事需要你决定"
                },
                style = MaterialTheme.typography.titleLarge,
                color = Ink,
            )
            if (decisions.isEmpty()) {
                Text(
                    "Agent 可以继续工作，你暂时不用介入。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                )
            } else if (!state.canControl) {
                Text(
                    "当前连接只有读取权限，因此这里只展示待确认摘要。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                )
            }
            decisions.forEach { (session, action) ->
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        session.project().ifBlank { session.agent() },
                        style = MaterialTheme.typography.labelMedium,
                        color = Hexa,
                    )
                    ActionRow(
                        action = action,
                        enabled = PendingAction(
                            PendingActionKind.APPROVAL,
                            session.id(),
                            action.id(),
                        ) !in state.pendingActions,
                        onResolve = { approved ->
                            callbacks.onResolve(session, action, approved)
                        },
                        controlsVisible = state.canActOnSessions,
                    )
                }
            }
        }
    }
}

@Composable
private fun SessionPanel(
    session: Models.Session,
    state: HumHumUiState,
    callbacks: HumHumCallbacks,
    showActions: Boolean = true,
    modifier: Modifier = Modifier,
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
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        color = Color.White,
        border = androidx.compose.foundation.BorderStroke(1.dp, if (session.needsAttention()) Hexa.copy(alpha = 0.45f) else Line),
    ) {
        Column(modifier = Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(session.project().ifBlank { session.agent() }, style = MaterialTheme.typography.titleMedium, color = Ink)
                    Text("${session.agent()} · ${session.status()} · ${session.lastActivityAt()}", style = MaterialTheme.typography.bodyMedium, color = Muted)
                }
                if (session.canReadConversation()) {
                    IconButton(onClick = { callbacks.onOpenConversation(session) }, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Outlined.ChatBubbleOutline, contentDescription = "查看对话", tint = Hexa)
                    }
                }
            }
            if (state.canActOnSessions && showActions) {
                session.actions().forEach { action ->
                    ActionRow(
                        action = action,
                        enabled = PendingAction(PendingActionKind.APPROVAL, session.id(), action.id()) !in state.pendingActions,
                        onResolve = { approved -> callbacks.onResolve(session, action, approved) },
                    )
                }
            }
            if (state.canActOnSessions && session.canMessage()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = draft,
                        onValueChange = { draft = it.take(4000) },
                        label = { Text("追问或补充") },
                        modifier = Modifier.weight(1f).testTag("follow-up-draft"),
                        shape = RoundedCornerShape(8.dp),
                        maxLines = 3,
                    )
                    IconButton(
                        onClick = {
                            val text = draft.trim()
                            if (text.isNotEmpty()) {
                                callbacks.onSendFollowUp(session, text)
                            }
                        },
                        enabled = draft.isNotBlank() && !followUpPending,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = "发送", tint = Hexa)
                    }
                }
            }
            if (state.conversation.sessionId == session.id()) {
                ConversationDisclosure(state = state, onClose = callbacks.onCloseConversation)
            }
        }
    }
}

@Composable
private fun ActionRow(
    action: Models.Action,
    enabled: Boolean,
    onResolve: (Boolean) -> Unit,
    controlsVisible: Boolean = true,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(action.summary().ifBlank { action.operation() }, style = MaterialTheme.typography.bodyMedium, color = Ink)
        if (controlsVisible) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { onResolve(true) },
                    enabled = enabled,
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Hexa),
                    modifier = Modifier.height(48.dp),
                ) { Text("允许") }
                OutlinedButton(
                    onClick = { onResolve(false) },
                    enabled = enabled,
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.height(48.dp),
                ) { Text("拒绝") }
            }
        }
    }
}

@Composable
private fun ConversationDisclosure(state: HumHumUiState, onClose: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable(onClick = onClose).padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("对话内容", style = MaterialTheme.typography.titleMedium, color = Ink)
            Spacer(Modifier.weight(1f))
            Icon(Icons.Outlined.ChevronRight, contentDescription = "收起", tint = Muted)
        }
        when {
            state.conversation.loading -> CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
            state.conversation.error != null -> Text(state.conversation.error, color = MaterialTheme.colorScheme.error)
            else -> state.conversation.messages.forEach { message ->
                Text(
                    text = "${if (message.role() == Models.ConversationRole.USER) "你" else "Agent"}：${message.text()}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Ink,
                )
            }
        }
    }
}
