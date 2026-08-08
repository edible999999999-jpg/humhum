package com.humhum.mobile;

import java.util.Arrays;
import java.util.List;

public final class MobileRoleDashboard {
    private MobileRoleDashboard() {}

    public enum Role {
        HUMI("humi", "Humi", "理解今天与你有关的事", R.string.role_humi_purpose),
        HYPE("hype", "Hype", "整理你的技能、偏好和记忆", R.string.role_hype_purpose),
        HUSH("hush", "Hush", "安静整理值得留意的消息", R.string.role_hush_purpose),
        HEXA("hexa", "Hexa", "观察 Agent 进展与确认", R.string.role_hexa_purpose);

        private final String id;
        private final String displayName;
        private final String purpose;
        private final int purposeRes;

        Role(String id, String displayName, String purpose, int purposeRes) {
            this.id = id;
            this.displayName = displayName;
            this.purpose = purpose;
            this.purposeRes = purposeRes;
        }

        public String id() { return id; }
        public String displayName() { return displayName; }
        public String purpose() { return purpose; }

        @androidx.annotation.StringRes
        public int purposeRes() { return purposeRes; }

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
