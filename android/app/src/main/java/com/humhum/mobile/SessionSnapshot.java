package com.humhum.mobile;

import java.util.List;

public final class SessionSnapshot {
    private final long savedAtMillis;
    private final List<Models.Session> sessions;

    public SessionSnapshot(long savedAtMillis, List<Models.Session> sessions) {
        this.savedAtMillis = savedAtMillis;
        this.sessions = List.copyOf(sessions);
    }

    public long savedAtMillis() { return savedAtMillis; }
    public List<Models.Session> sessions() { return sessions; }
}
