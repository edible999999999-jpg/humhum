package com.humhum.mobile;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Pattern;

public final class BridgeConfig {
    public static final int BRIDGE_PORT = 31276;
    private static final Pattern CODE = Pattern.compile("[A-Z0-9]{8}");
    private static final Pattern FINGERPRINT = Pattern.compile("[A-F0-9]{64}");

    private final String baseUrl;
    private final String host;
    private final String pairingCode;
    private final String fingerprint;
    private final String deviceName;

    @FunctionalInterface
    public interface HostPolicy {
        boolean allows(String host);
    }

    private BridgeConfig(
            String baseUrl, String host, String pairingCode, String fingerprint, String deviceName) {
        this.baseUrl = baseUrl;
        this.host = host;
        this.pairingCode = pairingCode;
        this.fingerprint = fingerprint;
        this.deviceName = deviceName;
    }

    public static BridgeConfig parse(
            String rawUrl, String rawCode, String rawFingerprint, String rawDeviceName) {
        return parse(rawUrl, rawCode, rawFingerprint, rawDeviceName, host -> false);
    }

    public static BridgeConfig parse(
            String rawUrl,
            String rawCode,
            String rawFingerprint,
            String rawDeviceName,
            HostPolicy additionalHostPolicy) {
        URI uri = parseUri(rawUrl, additionalHostPolicy);
        String code = value(rawCode).toUpperCase(Locale.ROOT);
        if (!CODE.matcher(code).matches()) {
            throw new IllegalArgumentException("Pairing code must contain eight letters or digits");
        }

        String fingerprint = normalizeFingerprint(rawFingerprint);
        String deviceName = normalizeDeviceName(rawDeviceName);

        String host = uri.getHost().toLowerCase(Locale.ROOT);
        return new BridgeConfig(
                "https://" + host + ":" + BRIDGE_PORT,
                host,
                code,
                fingerprint,
                deviceName);
    }

    public static BridgeConfig restore(String rawUrl, String rawFingerprint, String rawDeviceName) {
        URI uri = parseUri(rawUrl, host -> true);
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        return new BridgeConfig(
                "https://" + host + ":" + BRIDGE_PORT,
                host,
                "",
                normalizeFingerprint(rawFingerprint),
                normalizeDeviceName(rawDeviceName));
    }

    private static String normalizeFingerprint(String rawFingerprint) {
        String fingerprint = value(rawFingerprint)
                .replace(":", "")
                .replace("-", "")
                .replaceAll("\\s", "")
                .toUpperCase(Locale.ROOT);
        if (!FINGERPRINT.matcher(fingerprint).matches()) {
            throw new IllegalArgumentException("Certificate fingerprint must contain 64 hex digits");
        }
        return fingerprint;
    }

    private static String normalizeDeviceName(String rawDeviceName) {
        String deviceName = value(rawDeviceName);
        if (deviceName.isEmpty()) {
            deviceName = "Xiaomi Android";
        }
        if (deviceName.length() > 80) {
            throw new IllegalArgumentException("Device name is too long");
        }
        return deviceName;
    }

    private static URI parseUri(String rawUrl, HostPolicy additionalHostPolicy) {
        try {
            URI uri = new URI(value(rawUrl));
            String host = uri.getHost();
            String path = uri.getPath();
            if (!"https".equalsIgnoreCase(uri.getScheme())
                    || host == null
                    || uri.getPort() != BRIDGE_PORT
                    || uri.getUserInfo() != null
                    || uri.getQuery() != null
                    || uri.getFragment() != null
                    || !(path == null || path.isEmpty() || "/".equals(path))
                    || !(isPrivateHost(host)
                            || (isUsableIpv4(host)
                                    && additionalHostPolicy != null
                                    && additionalHostPolicy.allows(host)))) {
                throw new IllegalArgumentException("Use the private HTTPS bridge URL shown by HUMHUM");
            }
            return uri;
        } catch (URISyntaxException error) {
            throw new IllegalArgumentException("Bridge URL is invalid", error);
        }
    }

    private static boolean isPrivateHost(String host) {
        String normalized = host.toLowerCase(Locale.ROOT);
        if (normalized.endsWith(".local") && normalized.length() > ".local".length()) {
            return true;
        }
        int[] octets = parseIpv4(normalized);
        if (octets == null) {
            return false;
        }
        return octets[0] == 10
                || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
                || (octets[0] == 192 && octets[1] == 168)
                || (octets[0] == 169 && octets[1] == 254)
                || isTailnetAddress(octets);
    }

    private static boolean isUsableIpv4(String host) {
        int[] octets = parseIpv4(host.toLowerCase(Locale.ROOT));
        return octets != null
                && octets[0] > 0
                && octets[0] < 224
                && octets[0] != 127;
    }

    private static int[] parseIpv4(String normalized) {
        String[] parts = normalized.split("\\.", -1);
        if (parts.length != 4) {
            return null;
        }
        int[] octets = new int[4];
        try {
            for (int index = 0; index < parts.length; index++) {
                if (parts[index].isEmpty() || (parts[index].length() > 1 && parts[index].startsWith("0"))) {
                    return null;
                }
                octets[index] = Integer.parseInt(parts[index]);
                if (octets[index] < 0 || octets[index] > 255) {
                    return null;
                }
            }
        } catch (NumberFormatException error) {
            return null;
        }
        return octets;
    }

    private static boolean isTailnetAddress(int[] octets) {
        if (octets[0] != 100 || octets[1] < 64 || octets[1] > 127) {
            return false;
        }
        if ((octets[1] == 64 && octets[2] == 0 && octets[3] == 0)
                || (octets[1] == 127 && octets[2] == 255 && octets[3] == 255)) {
            return false;
        }
        return !(octets[1] == 100
                && (octets[2] == 0 || octets[2] == 100));
    }

    private static String value(String input) {
        return input == null ? "" : input.trim();
    }

    public String baseUrl() {
        return baseUrl;
    }

    String host() {
        return host;
    }

    public boolean isTailnet() {
        int[] octets = parseIpv4(host);
        return octets != null && isTailnetAddress(octets);
    }

    public String pairingCode() {
        return pairingCode;
    }

    public String fingerprint() {
        return fingerprint;
    }

    public String deviceName() {
        return deviceName;
    }
}
