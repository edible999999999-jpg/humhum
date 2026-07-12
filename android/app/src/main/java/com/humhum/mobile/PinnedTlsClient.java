package com.humhum.mobile;

import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import java.util.Locale;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.X509TrustManager;

public final class PinnedTlsClient {
    private static final int TIMEOUT_MILLIS = 8_000;

    private PinnedTlsClient() {}

    public static String sha256(X509Certificate certificate) throws CertificateException {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                hex.append(String.format(Locale.ROOT, "%02X", value & 0xff));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new CertificateException("SHA-256 is unavailable", error);
        }
    }

    public static X509TrustManager trustManager(String expectedFingerprint) {
        String expected = expectedFingerprint == null
                ? ""
                : expectedFingerprint.trim().toUpperCase(Locale.ROOT);
        return new X509TrustManager() {
            @Override
            public void checkClientTrusted(X509Certificate[] chain, String authType)
                    throws CertificateException {
                throw new CertificateException("Client certificates are not accepted");
            }

            @Override
            public void checkServerTrusted(X509Certificate[] chain, String authType)
                    throws CertificateException {
                if (chain == null || chain.length == 0 || chain[0] == null) {
                    throw new CertificateException("Server certificate is missing");
                }
                chain[0].checkValidity();
                String actual = sha256(chain[0]);
                if (!MessageDigest.isEqual(
                        expected.getBytes(StandardCharsets.US_ASCII),
                        actual.getBytes(StandardCharsets.US_ASCII))) {
                    throw new CertificateException("HUMHUM certificate fingerprint does not match");
                }
            }

            @Override
            public X509Certificate[] getAcceptedIssuers() {
                return new X509Certificate[0];
            }
        };
    }

    public static HttpsURLConnection open(
            BridgeConfig config, String path, String method, String bearerToken) throws IOException {
        return open(config, path, method, bearerToken, TIMEOUT_MILLIS);
    }

    public static HttpsURLConnection open(
            BridgeConfig config,
            String path,
            String method,
            String bearerToken,
            int readTimeoutMillis) throws IOException {
        if (path == null || !path.startsWith("/") || path.startsWith("//")) {
            throw new IllegalArgumentException("API path must be absolute within the bridge");
        }
        if (readTimeoutMillis < 1_000 || readTimeoutMillis > 30_000) {
            throw new IllegalArgumentException("Read timeout is outside the safe range");
        }
        try {
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, new X509TrustManager[] {trustManager(config.fingerprint())}, null);
            HttpsURLConnection connection = (HttpsURLConnection)
                    new URL(config.baseUrl() + path).openConnection();
            connection.setSSLSocketFactory(context.getSocketFactory());
            connection.setRequestMethod(method);
            connection.setConnectTimeout(TIMEOUT_MILLIS);
            connection.setReadTimeout(readTimeoutMillis);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            if (bearerToken != null && !bearerToken.isBlank()) {
                connection.setRequestProperty("Authorization", "Bearer " + bearerToken.trim());
            }
            return connection;
        } catch (GeneralSecurityException error) {
            throw new IOException("Could not initialize pinned TLS", error);
        }
    }
}
