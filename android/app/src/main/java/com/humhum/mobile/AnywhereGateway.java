package com.humhum.mobile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.List;
import java.util.function.LongSupplier;
import org.json.JSONException;
import org.json.JSONObject;

public final class AnywhereGateway {
    private static final int RESPONSE_POLLS = 4;
    private static final int RESPONSE_WAIT_SECONDS = 5;
    private final AnywhereRelayClient client;
    private final AnywhereStateStore state;
    private final LongSupplier clock;
    private final SecureRandom random = new SecureRandom();

    public AnywhereGateway(AnywhereRelayClient client, AnywhereStateStore state) {
        this(client, state, () -> System.currentTimeMillis() / 1_000L);
    }

    AnywhereGateway(
            AnywhereRelayClient client, AnywhereStateStore state, LongSupplier clock) {
        if (client == null || state == null || clock == null) {
            throw new IllegalArgumentException("Anywhere gateway is incomplete");
        }
        this.client = client;
        this.state = state;
        this.clock = clock;
    }

    public Models.SessionPage sessions(Models.WakeRelayConfig relay)
            throws IOException, JSONException, GeneralSecurityException {
        JSONObject data = request(relay, new JSONObject().put("action", "refresh"));
        return MobileProtocol.parseSessions(data.toString());
    }

    public List<Models.ConversationMessage> conversation(
            Models.WakeRelayConfig relay, Models.Session session)
            throws IOException, JSONException, GeneralSecurityException {
        MobileProtocol.conversationRequest(session);
        JSONObject data = request(relay, new JSONObject()
                .put("action", "conversation")
                .put("session_id", session.id()));
        return MobileProtocol.parseConversation(data.toString(), session.id());
    }

    public void resolveApproval(
            Models.WakeRelayConfig relay,
            Models.Scope scope,
            Models.Action action,
            String decision) throws IOException, JSONException, GeneralSecurityException {
        MobileProtocol.approvalRequest(action, decision, scope);
        request(relay, new JSONObject()
                .put("action", "approval")
                .put("provider", action.provider())
                .put("id", action.id())
                .put("decision", decision));
    }

    public String sendMessage(
            Models.WakeRelayConfig relay,
            Models.Scope scope,
            Models.Session session,
            String message) throws IOException, JSONException, GeneralSecurityException {
        MobileProtocol.RequestSpec validated = MobileProtocol.messageRequest(session, message, scope);
        JSONObject directBody = new JSONObject(validated.body());
        JSONObject data = request(relay, new JSONObject()
                .put("action", "message")
                .put("session_id", directBody.getString("session_id"))
                .put("provider", directBody.getString("provider"))
                .put("message", directBody.getString("message")));
        String status = data.optString("status", "queued");
        return status.length() > 32 ? status.substring(0, 32) : status;
    }

    private JSONObject request(Models.WakeRelayConfig relay, JSONObject body)
            throws IOException, JSONException, GeneralSecurityException {
        if (relay == null || relay.version() != 2) {
            throw new IOException("Anywhere remote access is unavailable");
        }
        String digest = sha256(body.toString());
        AnywhereStateStore.Pending pending = state.pending(relay);
        if (pending != null && !pending.bodyDigest().equals(digest)) {
            throw new IOException("A previous remote action is still being delivered");
        }
        if (pending == null) {
            long now = clock.getAsLong();
            String requestId = randomHex(16);
            AnywhereEnvelope envelope = AnywhereEnvelopeCipher.encrypt(
                    relay.commandKey(),
                    relay.commandChannelId(),
                    AnywhereEnvelopeCipher.Direction.UPLINK,
                    state.nextUplinkSequence(relay),
                    "request",
                    requestId,
                    now,
                    now + 300,
                    body,
                    randomHex(12));
            state.savePending(relay, requestId, digest, envelope);
            pending = state.pending(relay);
            if (pending == null) throw new IOException("Could not persist remote action");
        }
        client.publish(relay, pending.envelope());
        String requestId = pending.requestId();
        for (int attempt = 0; attempt < RESPONSE_POLLS; attempt++) {
            JSONObject cached = state.takeResponse(relay, requestId);
            if (cached != null) {
                state.completePending(relay);
                return responseData(cached);
            }
            long after = state.downlinkSequence(relay);
            List<AnywhereEnvelopeCipher.Message> messages = client.poll(
                    relay, after, RESPONSE_WAIT_SECONDS, clock.getAsLong());
            for (AnywhereEnvelopeCipher.Message message : messages) {
                if ("response".equals(message.kind())) {
                    state.saveResponseAndAdvance(
                            relay, message.sequence(), message.requestId(), message.body());
                    if (requestId.equals(message.requestId())) {
                        JSONObject response = state.takeResponse(relay, requestId);
                        if (response == null) throw new IOException("Remote response was not saved");
                        state.completePending(relay);
                        return responseData(response);
                    }
                } else {
                    state.advanceDownlink(relay, message.sequence());
                }
            }
        }
        throw new IOException("Mac has not answered the remote action yet");
    }

    private static JSONObject responseData(JSONObject response) throws IOException, JSONException {
        if (response == null || response.length() != 2 || !(response.get("ok") instanceof Boolean)) {
            throw new IOException("Remote response is invalid");
        }
        if (!response.getBoolean("ok")) {
            String error = response.optString("error", "Remote action failed");
            throw new IOException(error.length() > 200 ? error.substring(0, 200) : error);
        }
        Object data = response.get("data");
        if (!(data instanceof JSONObject)) throw new IOException("Remote response is invalid");
        return (JSONObject) data;
    }

    private String randomHex(int bytes) {
        byte[] value = new byte[bytes];
        random.nextBytes(value);
        return hex(value);
    }

    private static String sha256(String value) throws GeneralSecurityException {
        try {
            return hex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) {
            throw new GeneralSecurityException("SHA-256 is unavailable", error);
        }
    }

    private static String hex(byte[] value) {
        StringBuilder output = new StringBuilder(value.length * 2);
        for (byte item : value) output.append(String.format("%02x", item & 0xff));
        return output.toString();
    }
}
