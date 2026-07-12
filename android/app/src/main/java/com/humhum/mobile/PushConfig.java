package com.humhum.mobile;

public final class PushConfig {
    private final String applicationId;
    private final String apiKey;
    private final String projectId;
    private final String senderId;

    private PushConfig(String applicationId, String apiKey, String projectId, String senderId) {
        this.applicationId = applicationId;
        this.apiKey = apiKey;
        this.projectId = projectId;
        this.senderId = senderId;
    }

    public static PushConfig fromBuildValues(
            String applicationId,
            String apiKey,
            String projectId,
            String senderId) {
        String app = value(applicationId);
        String key = value(apiKey);
        String project = value(projectId);
        String sender = value(senderId);
        if (app.isEmpty() && key.isEmpty() && project.isEmpty() && sender.isEmpty()) return null;
        if (!app.matches("1:[0-9]{6,20}:android:[a-fA-F0-9]{6,64}")
                || !key.matches("[\\x21-\\x7e]{8,256}")
                || !project.matches("[a-z][a-z0-9-]{4,61}[a-z0-9]")
                || !sender.matches("[0-9]{6,20}")) {
            throw new IllegalArgumentException("Firebase client configuration is invalid");
        }
        return new PushConfig(app, key, project, sender);
    }

    private static String value(String value) {
        return value == null ? "" : value;
    }

    public String applicationId() { return applicationId; }
    public String apiKey() { return apiKey; }
    public String projectId() { return projectId; }
    public String senderId() { return senderId; }
}
