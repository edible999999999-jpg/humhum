package com.humhum.mobile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

public final class RelayPairingClient {
    private static final long MAX_WAIT_SECONDS = 90;
    private final AnywhereRelayClient relay;
    private final SecureRandom random = new SecureRandom();

    public RelayPairingClient(AnywhereRelayClient relay) {
        if (relay == null) throw new IllegalArgumentException("临时配对通道不可用");
        this.relay = relay;
    }

    public Models.PairResult pair(PairingSetup setup, String deviceName)
            throws IOException, JSONException, GeneralSecurityException {
        if (setup == null || !setup.canPairRemotely()) {
            throw new IllegalArgumentException("二维码不支持远程配对");
        }
        long issuedAt = nowSeconds();
        long deadline = Math.min(setup.expiresAt(), issuedAt + MAX_WAIT_SECONDS);
        if (deadline <= issuedAt) throw new IOException("配对二维码已过期，请在 Mac 上刷新");

        Models.WakeRelayConfig temporary = setup.pairingRelay();
        String requestId = randomHex(16);
        String replyKey = randomHex(32);
        JSONObject requestBody = new JSONObject()
                .put("operation", "pair")
                .put("code", setup.code())
                .put("device_name", normalizeDeviceName(deviceName))
                .put("reply_key", replyKey);
        AnywhereEnvelope request = AnywhereEnvelopeCipher.encrypt(
                temporary.commandKey(),
                temporary.commandChannelId(),
                AnywhereEnvelopeCipher.Direction.UPLINK,
                1,
                "request",
                requestId,
                issuedAt,
                deadline,
                requestBody,
                randomHex(12));
        relay.publish(temporary, request);

        long after = 0;
        while (nowSeconds() <= deadline) {
            long now = nowSeconds();
            int waitSeconds = (int) Math.max(0, Math.min(20, deadline - now));
            List<AnywhereEnvelopeCipher.Message> messages =
                    relay.poll(temporary, after, waitSeconds, now);
            for (AnywhereEnvelopeCipher.Message message : messages) {
                after = message.sequence();
                if (!"response".equals(message.kind())
                        || !requestId.equals(message.requestId())) {
                    continue;
                }
                return openResponse(message.body(), requestId, replyKey, now);
            }
        }
        throw new IOException("远程配对等待超时，请在 Mac 上刷新二维码后重试");
    }

    private static Models.PairResult openResponse(
            JSONObject body,
            String requestId,
            String replyKey,
            long now) throws IOException, JSONException, GeneralSecurityException {
        Object okValue = body.opt("ok");
        if (!(okValue instanceof Boolean) || body.length() != 2) {
            throw new IOException("Mac 返回了无效的配对结果");
        }
        if (!((Boolean) okValue)) {
            String error = body.optString("error", "Mac 拒绝了这次配对");
            throw new IOException(error.length() <= 160 ? error : "Mac 拒绝了这次配对");
        }
        if (!(body.opt("sealed") instanceof JSONObject)) {
            throw new IOException("Mac 返回了无效的加密配对结果");
        }
        AnywhereEnvelopeCipher.Message sealed = AnywhereEnvelopeCipher.decrypt(
                replyKey,
                responseChannel(requestId),
                AnywhereEnvelopeCipher.Direction.DOWNLINK,
                0,
                body.getJSONObject("sealed").toString(),
                now);
        if (!"response".equals(sealed.kind())
                || !requestId.equals(sealed.requestId())
                || sealed.body().length() != 1
                || !(sealed.body().opt("pairing") instanceof JSONObject)) {
            throw new IOException("Mac 返回了无效的加密配对结果");
        }
        Models.PairResult result = MobileProtocol.parsePairResult(
                sealed.body().getJSONObject("pairing").toString());
        if (result.wakeRelay() == null || result.wakeRelay().version() != 2) {
            throw new IOException("Mac 没有返回可用的远程连接");
        }
        return result;
    }

    static String responseChannel(String requestId) {
        if (requestId == null || !requestId.matches("[a-f0-9]{32}")) {
            throw new IllegalArgumentException("临时配对请求无效");
        }
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] value = digest.digest(
                    ("humhum-pairing-response-v1:" + requestId)
                            .getBytes(StandardCharsets.UTF_8));
            return hex(value);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 不可用", error);
        }
    }

    private String randomHex(int byteCount) {
        byte[] value = new byte[byteCount];
        random.nextBytes(value);
        return hex(value);
    }

    private static String normalizeDeviceName(String value) {
        String name = value == null ? "" : value.trim();
        if (name.isEmpty()) return "Xiaomi Android";
        if (name.length() > 80) return name.substring(0, 80);
        return name;
    }

    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format("%02x", item & 0xff));
        return result.toString();
    }

    private static long nowSeconds() {
        return System.currentTimeMillis() / 1000L;
    }
}
