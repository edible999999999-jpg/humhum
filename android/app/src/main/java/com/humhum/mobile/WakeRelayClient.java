package com.humhum.mobile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class WakeRelayClient {
    private static final int LONG_POLL_READ_TIMEOUT_MILLIS = 25_000;
    private static final int MAX_MESSAGES = 128;
    private static final int MAX_RESPONSE_BYTES = 1_048_576;
    private final Transport transport;

    public WakeRelayClient() {
        this(new UrlConnectionTransport());
    }

    WakeRelayClient(Transport transport) {
        if (transport == null) throw new IllegalArgumentException("Relay transport is missing");
        this.transport = transport;
    }

    static String validateBaseUrl(String value) {
        String safe = value == null ? "" : value.trim();
        if (safe.isEmpty() || safe.length() > 2_048) {
            throw new IllegalArgumentException("Relay URL is invalid");
        }
        try {
            URI uri = new URI(safe);
            String scheme = uri.getScheme() == null
                    ? ""
                    : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            String path = uri.getRawPath();
            boolean cleanPath = path == null || path.isEmpty() || "/".equals(path);
            if (host == null
                    || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null
                    || uri.getRawFragment() != null
                    || !cleanPath) {
                throw new IllegalArgumentException("Relay URL is invalid");
            }
            boolean loopback = "localhost".equalsIgnoreCase(host)
                    || "127.0.0.1".equals(host)
                    || "::1".equals(host);
            if (!("https".equals(scheme) || ("http".equals(scheme) && loopback))) {
                throw new IllegalArgumentException("Relay URL must use HTTPS");
            }
            String normalized = uri.toString();
            return normalized.endsWith("/")
                    ? normalized.substring(0, normalized.length() - 1)
                    : normalized;
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Relay URL is invalid", error);
        }
    }

    static RequestSpec pollRequest(Models.WakeRelayConfig config, long after) {
        if (config == null || after < 0) {
            throw new IllegalArgumentException("Relay poll state is invalid");
        }
        return new RequestSpec(
                "GET",
                config.baseUrl() + "/v1/channels/" + config.channelId()
                        + "/messages?after=" + after + "&wait=20",
                "Bearer " + config.subscriberToken(),
                LONG_POLL_READ_TIMEOUT_MILLIS);
    }

    static List<WakeEnvelope> parseMessages(String payload, long expectedAfter)
            throws JSONException {
        if (payload == null || payload.length() > 1_048_576 || expectedAfter < 0) {
            throw new JSONException("Relay response is invalid");
        }
        JSONObject root = new JSONObject(payload);
        if (root.length() != 1 || !root.has("messages")) {
            throw new JSONException("Relay response shape is invalid");
        }
        JSONArray source = root.getJSONArray("messages");
        if (source.length() > MAX_MESSAGES) {
            throw new JSONException("Relay response has too many messages");
        }
        List<WakeEnvelope> result = new ArrayList<>();
        long previous = expectedAfter;
        for (int index = 0; index < source.length(); index++) {
            JSONObject item = source.getJSONObject(index);
            if (item.length() != 4
                    || !item.has("version")
                    || !item.has("sequence")
                    || !item.has("nonce")
                    || !item.has("ciphertext")) {
                throw new JSONException("Relay envelope shape is invalid");
            }
            long version = strictLong(item, "version");
            long sequence = strictLong(item, "sequence");
            String nonce = item.getString("nonce");
            String ciphertext = item.getString("ciphertext");
            if (version != 1
                    || sequence <= previous
                    || nonce.length() != 16
                    || !nonce.matches("[A-Za-z0-9_-]+")
                    || ciphertext.isEmpty()
                    || ciphertext.length() > 4_096
                    || !ciphertext.matches("[A-Za-z0-9_-]+")) {
                throw new JSONException("Relay envelope is invalid");
            }
            result.add(new WakeEnvelope((int) version, sequence, nonce, ciphertext));
            previous = sequence;
        }
        return List.copyOf(result);
    }

    private static long strictLong(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof Integer) && !(value instanceof Long)) {
            throw new JSONException("Relay numeric field is invalid");
        }
        return ((Number) value).longValue();
    }

    static boolean shouldUseRelay(Models.WakeRelayConfig config, boolean monitorEnabled) {
        return monitorEnabled && config != null;
    }

    static boolean isPermanentlyUnavailable(int status) {
        return status == 401 || status == 404 || status == 410;
    }

    static long authenticate(
            Models.WakeRelayConfig config,
            long expectedAfter,
            List<WakeEnvelope> messages,
            long nowSeconds) throws GeneralSecurityException, JSONException {
        if (config == null || expectedAfter < 0 || messages == null) {
            throw new GeneralSecurityException("Relay wake state is invalid");
        }
        long accepted = expectedAfter;
        for (WakeEnvelope envelope : messages) {
            WakeEnvelope.WakeSignal signal = WakeEnvelope.decrypt(
                    config.wakeKey(),
                    config.channelId(),
                    accepted,
                    envelope.toJson(),
                    nowSeconds);
            accepted = signal.sequence();
        }
        return accepted;
    }

    public long poll(Models.WakeRelayConfig config, long expectedAfter, long nowSeconds)
            throws IOException, GeneralSecurityException, JSONException {
        TransportResponse response = transport.execute(pollRequest(config, expectedAfter));
        if (response.status() != HttpURLConnection.HTTP_OK) {
            throw new RelayStatusException(response.status());
        }
        byte[] body = response.body();
        if (body.length > MAX_RESPONSE_BYTES) {
            throw new IOException("Relay response is too large");
        }
        List<WakeEnvelope> messages = parseMessages(
                new String(body, StandardCharsets.UTF_8), expectedAfter);
        return authenticate(config, expectedAfter, messages, nowSeconds);
    }

    interface Transport {
        TransportResponse execute(RequestSpec request) throws IOException;
    }

    static final class TransportResponse {
        private final int status;
        private final byte[] body;

        TransportResponse(int status, byte[] body) {
            this.status = status;
            this.body = body == null ? new byte[0] : body.clone();
        }

        int status() { return status; }
        byte[] body() { return body.clone(); }
    }

    public static final class RelayStatusException extends IOException {
        private final int status;

        RelayStatusException(int status) {
            super("Wake relay request failed");
            this.status = status;
        }

        public int status() { return status; }
    }

    private static final class UrlConnectionTransport implements Transport {
        @Override
        public TransportResponse execute(RequestSpec request) throws IOException {
            HttpURLConnection connection = (HttpURLConnection) new URL(request.url()).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod(request.method());
            connection.setConnectTimeout(8_000);
            connection.setReadTimeout(request.readTimeoutMillis());
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", request.authorization());
            try {
                int status = connection.getResponseCode();
                InputStream input = status >= 200 && status < 400
                        ? connection.getInputStream()
                        : connection.getErrorStream();
                return new TransportResponse(status, readBounded(input));
            } finally {
                connection.disconnect();
            }
        }

        private static byte[] readBounded(InputStream input) throws IOException {
            if (input == null) return new byte[0];
            try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8_192];
                int total = 0;
                int count;
                while ((count = stream.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_RESPONSE_BYTES) {
                        throw new IOException("Relay response is too large");
                    }
                    output.write(buffer, 0, count);
                }
                return output.toByteArray();
            }
        }
    }

    static final class RequestSpec {
        private final String method;
        private final String url;
        private final String authorization;
        private final int readTimeoutMillis;

        RequestSpec(String method, String url, String authorization, int readTimeoutMillis) {
            this.method = method;
            this.url = url;
            this.authorization = authorization;
            this.readTimeoutMillis = readTimeoutMillis;
        }

        String method() { return method; }
        String url() { return url; }
        String authorization() { return authorization; }
        int readTimeoutMillis() { return readTimeoutMillis; }
    }
}
