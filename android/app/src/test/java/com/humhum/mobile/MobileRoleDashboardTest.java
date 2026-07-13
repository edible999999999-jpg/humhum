package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.List;
import org.junit.Test;

public class MobileRoleDashboardTest {
    @Test
    public void rolesKeepTheProductOrderAndIdentity() {
        assertEquals(
                List.of("humi", "hype", "hush", "hexa"),
                MobileRoleDashboard.roles().stream()
                        .map(MobileRoleDashboard.Role::id)
                        .toList());
        assertEquals(
                List.of("Humi", "Hype", "Hush", "Hexa"),
                MobileRoleDashboard.roles().stream()
                        .map(MobileRoleDashboard.Role::displayName)
                        .toList());
    }

    @Test
    public void emptySummaryStaysCalmAndDoesNotInventWork() {
        MobileRoleDashboard.Summary summary = MobileRoleDashboard.summarize(List.of());

        assertEquals(0, summary.sessionCount());
        assertEquals(0, summary.attentionCount());
        assertFalse(summary.hasAttention());
        assertEquals("现在很安静", summary.title());
        assertEquals("最近没有需要你处理的 Agent 会话。", summary.detail());
    }

    @Test
    public void summaryCountsRealSessionsAndAttention() {
        List<Models.Session> sessions = List.of(
                session("android-ui", false),
                session("release", true),
                session("mobile-bridge", false));

        MobileRoleDashboard.Summary summary = MobileRoleDashboard.summarize(sessions);

        assertEquals(3, summary.sessionCount());
        assertEquals(1, summary.attentionCount());
        assertTrue(summary.hasAttention());
        assertEquals("有 1 件事需要你决定", summary.title());
        assertEquals("另外 2 个会话仍在继续。", summary.detail());
    }

    @Test
    public void activeSummaryExplainsWhenNothingNeedsAttention() {
        MobileRoleDashboard.Summary summary = MobileRoleDashboard.summarize(List.of(
                session("android-ui", false),
                session("release", false)));

        assertEquals("2 个 Agent 会话正在继续", summary.title());
        assertEquals("目前没有等待你处理的确认。", summary.detail());
    }

    private static Models.Session session(String id, boolean needsAttention) {
        return new Models.Session(
                id,
                "Codex",
                id,
                "working",
                "刚刚",
                needsAttention,
                true,
                List.of());
    }
}
