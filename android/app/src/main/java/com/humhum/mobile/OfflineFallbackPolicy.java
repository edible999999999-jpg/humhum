package com.humhum.mobile;

import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.cert.CertificateException;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;
import javax.net.ssl.SSLException;
import org.json.JSONException;

final class OfflineFallbackPolicy {
    private static final int MAX_CAUSE_DEPTH = 16;

    private OfflineFallbackPolicy() {}

    static boolean canUseSnapshot(Throwable error) {
        Set<Throwable> visited = Collections.newSetFromMap(new IdentityHashMap<>());
        Throwable current = error;
        boolean transportUnreachable = false;
        for (int depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
            if (current == null) return transportUnreachable;
            if (!visited.add(current)) return false;
            if (isExplicitlyDenied(current)) return false;
            if (isTransportUnreachable(current)) transportUnreachable = true;
            try {
                current = current.getCause();
            } catch (RuntimeException ignored) {
                return false;
            }
        }
        return false;
    }

    private static boolean isExplicitlyDenied(Throwable error) {
        return error instanceof MobileProtocol.HttpStatusException
                || error instanceof JSONException
                || error instanceof SSLException
                || error instanceof CertificateException
                || error instanceof RuntimeException;
    }

    private static boolean isTransportUnreachable(Throwable error) {
        return error instanceof ConnectException
                || error instanceof UnknownHostException
                || error instanceof NoRouteToHostException
                || error instanceof SocketTimeoutException
                || error instanceof SocketException;
    }
}
