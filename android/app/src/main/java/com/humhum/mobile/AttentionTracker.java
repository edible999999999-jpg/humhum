package com.humhum.mobile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class AttentionTracker {
    static final int MAX_DIGESTS = 200;
    private final LinkedHashSet<String> known = new LinkedHashSet<>();

    public AttentionTracker(Collection<String> existingDigests) {
        if (existingDigests == null) return;
        for (String digest : existingDigests) {
            if (digest != null && digest.matches("[a-f0-9]{64}")) {
                remember(digest);
            }
        }
    }

    public Result evaluate(Models.SessionPage page) {
        if (page == null) return new Result(0, known);
        int newCount = 0;
        int accepted = 0;
        Set<String> current = new LinkedHashSet<>();
        for (Models.Session session : page.sessions()) {
            for (Models.Action action : session.actions()) {
                if (accepted >= MAX_DIGESTS) break;
                String digest = digest(session.id(), action.provider(), action.id());
                if (!current.add(digest)) continue;
                accepted++;
                if (!known.contains(digest)) {
                    remember(digest);
                    newCount++;
                }
            }
            if (accepted >= MAX_DIGESTS) break;
        }
        return new Result(newCount, known);
    }

    private void remember(String digest) {
        if (!known.add(digest)) return;
        while (known.size() > MAX_DIGESTS) {
            String oldest = known.iterator().next();
            known.remove(oldest);
        }
    }

    private static String digest(String sessionId, String provider, String actionId) {
        String identity = sessionId + "\u0000" + provider + "\u0000" + actionId;
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256")
                    .digest(identity.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte value : bytes) hex.append(String.format("%02x", value & 0xff));
            return hex.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    public static final class Result {
        private final int newCount;
        private final List<String> knownDigests;

        Result(int newCount, Collection<String> knownDigests) {
            this.newCount = newCount;
            this.knownDigests = List.copyOf(new ArrayList<>(knownDigests));
        }

        public int newCount() { return newCount; }
        public List<String> knownDigests() { return knownDigests; }
    }
}
