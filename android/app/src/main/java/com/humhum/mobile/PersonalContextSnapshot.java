package com.humhum.mobile;

public final class PersonalContextSnapshot {
    private static final long MAX_AGE_MILLIS = 24L * 60L * 60L * 1000L;

    private final long savedAtMillis;
    private final Models.PersonalContext context;

    public PersonalContextSnapshot(long savedAtMillis, Models.PersonalContext context) {
        if (savedAtMillis <= 0 || context == null) {
            throw new IllegalArgumentException("Personal context snapshot is invalid");
        }
        this.savedAtMillis = savedAtMillis;
        this.context = context;
    }

    public long savedAtMillis() { return savedAtMillis; }
    public Models.PersonalContext context() { return context; }

    public static boolean isFresh(long savedAtMillis, long nowMillis) {
        return savedAtMillis > 0
                && nowMillis >= savedAtMillis
                && nowMillis - savedAtMillis < MAX_AGE_MILLIS;
    }
}
