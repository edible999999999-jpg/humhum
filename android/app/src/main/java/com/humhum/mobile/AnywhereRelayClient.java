package com.humhum.mobile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class AnywhereRelayClient {
    private static final int MAX_RESPONSE_BYTES = 1_048_576;
    private static final int MAX_MESSAGES = 128;
    private final Transport transport;

    public AnywhereRelayClient() {
        this(new UrlConnectionTransport());
    }

    AnywhereRelayClient(Transport transport) {
        if (transport == null) throw new IllegalArgumentException("Relay transport is missing");
        this.transport = transport;
    }

    static RequestSpec publishRequest(
            Models.WakeRelayConfig relay, AnywhereEnvelope envelope) throws JSONException {
        requireV2(relay);
        if (envelope == null || envelope.version() != 1 || envelope.sequence() <= 0) {
            throw new IllegalArgumentException("Anywhere publication is invalid");
        }
        return new RequestSpec(
                "POST",
                relay.baseUrl() + "/v1/channels/" + relay.commandChannelId() + "/messages",
                "Bearer " + relay.commandPublisherToken(),
                10_000,
                envelope.toJson());
    }

    static RequestSpec pollRequest(Models.WakeRelayConfig relay, long after, int waitSeconds) {
        requireV2(relay);
        if (after < 0 || waitSeconds < 0 || waitSeconds > 20) {
            throw new IllegalArgumentException("Anywhere poll state is invalid");
        }
        return new RequestSpec(
                "GET",
                relay.baseUrl() + "/v1/channels/" + relay.channelId()
                        + "/messages?after=" + after + "&wait=" + waitSeconds,
                "Bearer " + relay.subscriberToken(),
                waitSeconds * 1_000 + 5_000,
                null);
    }

    public void publish(Models.WakeRelayConfig relay, AnywhereEnvelope envelope)
            throws IOException, JSONException {
        TransportResponse response = transport.execute(publishRequest(relay, envelope));
        if (response.status() != HttpURLConnection.HTTP_CREATED) {
            throw new RelayStatusException(response.status());
        }
        byte[] bytes = response.body();
        if (bytes.length > 128) throw new IOException("Anywhere publication response is invalid");
        JSONObject body = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (body.length() != 1 || body.getLong("sequence") != envelope.sequence()) {
            throw new IOException("Anywhere publication response is invalid");
        }
    }

    public List<AnywhereEnvelopeCipher.Message> poll(
            Models.WakeRelayConfig relay,
            long expectedAfter,
            int waitSeconds,
            long nowSeconds) throws IOException, JSONException, GeneralSecurityException {
        TransportResponse response = transport.execute(pollRequest(relay, expectedAfter, waitSeconds));
        if (response.status() != HttpURLConnection.HTTP_OK) {
            throw new RelayStatusException(response.status());
        }
        byte[] bytes = response.body();
        if (bytes.length > MAX_RESPONSE_BYTES) throw new IOException("Anywhere response is too large");
        JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        if (root.length() != 1 || !(root.get("messages") instanceof JSONArray)) {
            throw new JSONException("Anywhere response shape is invalid");
        }
        JSONArray source = root.getJSONArray("messages");
        if (source.length() > MAX_MESSAGES) throw new JSONException("Too many Anywhere messages");
        long previous = expectedAfter;
        List<AnywhereEnvelopeCipher.Message> result = new ArrayList<>();
        for (int index = 0; index < source.length(); index++) {
            JSONObject item = source.getJSONObject(index);
            Object sequenceValue = item.get("sequence");
            if (item.length() != 4
                    || (!(sequenceValue instanceof Integer) && !(sequenceValue instanceof Long))
                    || ((Number) sequenceValue).longValue() <= previous) {
                throw new JSONException("Anywhere message sequence is invalid");
            }
            AnywhereEnvelopeCipher.Message message = AnywhereEnvelopeCipher.decrypt(
                    relay.wakeKey(),
                    relay.channelId(),
                    AnywhereEnvelopeCipher.Direction.DOWNLINK,
                    previous,
                    item.toString(),
                    nowSeconds);
            previous = message.sequence();
            result.add(message);
        }
        return List.copyOf(result);
    }

    public void cancel() {
        transport.cancel();
    }

    private static void requireV2(Models.WakeRelayConfig relay) {
        if (relay == null || relay.version() != 2) {
            throw new IllegalArgumentException("Anywhere relay is unavailable");
        }
    }

    interface Transport {
        TransportResponse execute(RequestSpec request) throws IOException;
        default void cancel() {}
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

        public RelayStatusException(int status) {
            super("Anywhere relay request failed");
            this.status = status;
        }

        public int status() { return status; }
    }

    static final class RequestSpec {
        private final String method;
        private final String url;
        private final String authorization;
        private final int readTimeoutMillis;
        private final String body;

        RequestSpec(
                String method,
                String url,
                String authorization,
                int readTimeoutMillis,
                String body) {
            this.method = method;
            this.url = url;
            this.authorization = authorization;
            this.readTimeoutMillis = readTimeoutMillis;
            this.body = body;
        }

        String method() { return method; }
        String url() { return url; }
        String authorization() { return authorization; }
        int readTimeoutMillis() { return readTimeoutMillis; }
        String body() { return body; }
    }

    private static final class UrlConnectionTransport implements Transport {
        private final AtomicReference<HttpURLConnection> active = new AtomicReference<>();

        @Override public TransportResponse execute(RequestSpec request) throws IOException {
            HttpURLConnection connection = (HttpURLConnection) new URL(request.url()).openConnection();
            active.set(connection);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod(request.method());
            connection.setConnectTimeout(8_000);
            connection.setReadTimeout(request.readTimeoutMillis());
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", request.authorization());
            if (request.body() != null) {
                byte[] payload = request.body().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(payload.length);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(payload);
                }
            }
            try {
                int status = connection.getResponseCode();
                InputStream input = status >= 200 && status < 400
                        ? connection.getInputStream()
                        : connection.getErrorStream();
                return new TransportResponse(status, readBounded(input));
            } finally {
                active.compareAndSet(connection, null);
                connection.disconnect();
            }
        }

        @Override public void cancel() {
            HttpURLConnection connection = active.getAndSet(null);
            if (connection != null) connection.disconnect();
        }

        private static byte[] readBounded(InputStream input) throws IOException {
            if (input == null) return new byte[0];
            try (InputStream stream = input;
                    ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8_192];
                int total = 0;
                int count;
                while ((count = stream.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_RESPONSE_BYTES) {
                        throw new IOException("Anywhere response is too large");
                    }
                    output.write(buffer, 0, count);
                }
                return output.toByteArray();
            }
        }
    }
}
