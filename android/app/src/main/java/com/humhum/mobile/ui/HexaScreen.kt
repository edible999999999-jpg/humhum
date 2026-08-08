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
import androidx.compose.ui.res.stringResource
import com.humhum.mobile.R
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import com.humhum.mobile.MobileRoleDashboard
import com.humhum.mobile.Models
import com.humhum.mobile.app.HumHumUiState
import com.humhum.mobile.app.PendingAction
import com.humhum.mobile.app.PendingActionKind
import com.humhum.mobile.app.StatusText
import com.humhum.mobile.app.resolve
import com.humhum.mobile.ui.theme.Hexa
import com.humhum.mobile.ui.theme.HexaPanel
import com.humhum.mobile.ui.theme.HexaPanelMuted
import com.humhum.mobile.ui.theme.HexaPanelRaised
import com.humhum.mobile.ui.theme.HexaPanelText
import com.humhum.mobile.ui.theme.HexaSignal
import com.humhum.mobile.ui.theme.HumHumMono
import com.humhum.mobile.ui.theme.Ink
import com.humhum.mobile.ui.theme.Line
import com.humhum.mobile.ui.theme.Muted
import com.humhum.mobile.ui.theme.EditorialHero
import com.humhum.mobile.ui.theme.EditorialMetrics
import com.humhum.mobile.ui.theme.EditorialSection
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
            start = EditorialMetrics.HorizontalPadding,
            end = EditorialMetrics.HorizontalPadding,
            top = 15.dp,
            bottom = EditorialMetrics.ContentBottomPadding,
        ),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(
                    "${editorialSpecFor(MobileRoleDashboard.Role.HEXA).indexLabel} · NOW RUNNING",
                    style = MaterialTheme.typography.labelMedium.copy(
                        fontFamily = HumHumMono,
                        fontWeight = FontWeight.Bold,
                        fontSize = 9.sp,
                    ),
                    color = HexaSignal,
                )
                val agentSessionLabel = stringResource(R.string.hexa_agent_session)
                Text(
                    orderedSessions.firstOrNull()?.project()?.ifBlank { agentSessionLabel }
                        ?: agentSessionLabel,
                    style = EditorialHero,
                    color = HexaPanelText,
                )
                Text(
                    if (state.canControl) {
                        stringResource(R.string.hexa_control_intro)
                    } else {
                        stringResource(R.string.hexa_read_only_intro)
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
                        Text(stringResource(R.string.hexa_quiet_title), style = MaterialTheme.typography.titleMedium, color = HexaPanelText)
                        Text(
                            stringResource(R.string.hexa_quiet_detail),
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
                        title = stringResource(R.string.hexa_other_sessions),
                        trailing = stringResource(R.string.hexa_count_entries, orderedSessions.size - 1),
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
                        stringResource(R.string.hexa_following),
                        trailing = stringResource(R.string.hexa_agent_count, state.personalContext!!.agents().size),
                        dark = true,
                        accent = HexaSignal,
                    )
                    state.personalContext!!.agents().take(3).forEach { agent ->
                        RoomItem(
                            title = agent.name(),
                            detail = agent.currentStep() ?: agent.status(),
                            accent = Hexa,
                            meta = if (agent.needsUser()) stringResource(R.string.hexa_needs_you) else agent.status(),
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
                    fontFamily = HumHumMono,
                    fontSize = 8.sp,
                ),
                color = HexaSignal,
            )
            Text(
                "ENCRYPTED",
                style = MaterialTheme.typography.labelMedium.copy(
                    fontFamily = HumHumMono,
                    fontSize = 8.sp,
                ),
                color = HexaPanelMuted,
            )
            Text(
                "$sessionCount AGENTS",
                style = MaterialTheme.typography.labelMedium.copy(
                    fontFamily = HumHumMono,
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
                        style = MaterialTheme.typography.bodyMedium.copy(fontFamily = HumHumMono),
                        color = metadataColor,
                    )
                }
                Text(
                    if (session.needsAttention()) stringResource(R.string.hexa_needs_you) else stringResource(R.string.hexa_working),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (session.needsAttention()) Color(0xFFFFA7A7) else accentColor,
                )
                if (session.canReadConversation()) {
                    IconButton(onClick = { callbacks.onOpenConversation(session) }, modifier = Modifier.size(48.dp)) {
                        Icon(
                            Icons.Outlined.ChatBubbleOutline,
                            contentDescription = stringResource(R.string.hexa_view_conversation),
                            tint = accentColor,
                        )
                    }
                }
            }
            if (primary) {
                Text(
                    if (session.needsAttention()) {
                        stringResource(R.string.hexa_primary_waiting)
                    } else {
                        stringResource(R.string.hexa_primary_continuing)
                    },
                    style = EditorialSection,
                    color = HexaPanelText,
                )
                Text(
                    if (session.needsAttention()) {
                        stringResource(R.string.hexa_primary_waiting_detail)
                    } else {
                        stringResource(R.string.hexa_primary_continuing_detail)
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = metadataColor,
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
                        label = { Text(stringResource(R.string.hexa_follow_up_label)) },
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
                            contentDescription = stringResource(R.string.hexa_send),
                        )
                    }
                }
                state.followUpFeedback[session.id()]?.let { feedback ->
                    Text(
                        text = feedback.resolve(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (feedback is StatusText.Res) {
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
            ) { Text(stringResource(R.string.common_allow)) }
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
            ) { Text(stringResource(R.string.common_deny)) }
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
            Text(stringResource(R.string.hexa_conversation_title), style = MaterialTheme.typography.titleMedium, color = titleColor)
            Spacer(Modifier.weight(1f))
            Icon(Icons.Outlined.ChevronRight, contentDescription = stringResource(R.string.hexa_collapse), tint = secondaryColor)
        }
        when {
            state.conversation.loading -> CircularProgressIndicator(
                modifier = Modifier.size(22.dp),
                color = if (dark) HexaSignal else Hexa,
                strokeWidth = 2.dp,
            )
            state.conversation.error != null -> Text(state.conversation.error, color = MaterialTheme.colorScheme.error)
            else -> state.conversation.messages.forEach { message ->
                val roleLabel = if (message.role() == Models.ConversationRole.USER) stringResource(R.string.common_you) else stringResource(R.string.common_agent)
                Text(
                    text = "$roleLabel：${message.text()}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = titleColor,
                )
            }
        }
    }
}
