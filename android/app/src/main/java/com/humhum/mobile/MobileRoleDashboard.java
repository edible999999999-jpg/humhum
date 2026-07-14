package com.humhum.mobile;

import java.util.Arrays;
import java.util.List;

public final class MobileRoleDashboard {
    private MobileRoleDashboard() {}

    public enum Role {
        HUMI("humi", "Humi", "理解今天与你有关的事"),
        HYPE("hype", "Hype", "整理你的技能、偏好和记忆"),
        HUSH("hush", "Hush", "安静整理值得留意的消息"),
        HEXA("hexa", "Hexa", "观察 Agent 进展与确认" );

        private final String id;
        private final String displayName;
        private final String purpose;

        Role(String id, String displayName, String purpose) {
            this.id = id;
            this.displayName = displayName;
            this.purpose = purpose;
        }

        public String id() { return id; }
        public String displayName() { return displayName; }
        public String purpose() { return purpose; }

        public static Role fromId(String id) {
            for (Role role : values()) {
                if (role.id.equals(id)) return role;
            }
            return HUMI;
        }
    }

    public record Summary(
            int sessionCount,
            int attentionCount,
            String title,
            String detail) {
        public boolean hasAttention() {
            return attentionCount > 0;
        }
    }

    public static List<Role> roles() {
        return Arrays.asList(Role.values());
    }

    public static Summary summarize(List<Models.Session> sessions) {
        List<Models.Session> safeSessions = sessions == null ? List.of() : sessions;
        int sessionCount = safeSessions.size();
        int attentionCount = (int) safeSessions.stream()
                .filter(Models.Session::needsAttention)
                .count();

        if (sessionCount == 0) {
            return new Summary(0, 0, "现在很安静", "最近没有需要你处理的 Agent 会话。");
        }
        if (attentionCount > 0) {
            int continuing = Math.max(0, sessionCount - attentionCount);
            String detail = continuing == 0
                    ? "这些会话正在等你处理。"
                    : "另外 " + continuing + " 个会话仍在继续。";
            return new Summary(
                    sessionCount,
                    attentionCount,
                    "有 " + attentionCount + " 件事需要你决定",
                    detail);
        }
        return new Summary(
                sessionCount,
                0,
                sessionCount + " 个 Agent 会话正在继续",
                "目前没有等待你处理的确认。");
    }
}
