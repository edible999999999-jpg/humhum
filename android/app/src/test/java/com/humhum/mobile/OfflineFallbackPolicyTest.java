package com.humhum.mobile;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.net.ConnectException;
import java.net.NoRouteToHostException;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.security.cert.CertificateException;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLHandshakeException;
import org.json.JSONException;
import org.junit.Test;

public class OfflineFallbackPolicyTest {
    @Test
    public void allowsOnlyTransportUnreachableFailures() {
        assertTrue(OfflineFallbackPolicy.canUseSnapshot(new ConnectException("refused")));
        assertTrue(OfflineFallbackPolicy.canUseSnapshot(new UnknownHostException("offline")));
        assertTrue(OfflineFallbackPolicy.canUseSnapshot(new NoRouteToHostException("no route")));
        assertTrue(OfflineFallbackPolicy.canUseSnapshot(new SocketTimeoutException("timed out")));
        assertTrue(OfflineFallbackPolicy.canUseSnapshot(new SocketException("network down")));
    }

    @Test
    public void rejectsProtocolTlsParsingAndRuntimeFailures() {
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(
                new MobileProtocol.HttpStatusException(503, "unavailable")));
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(new JSONException("invalid JSON")));
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(new SSLException("TLS failed")));
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(
                new SSLHandshakeException("certificate pin failed")));
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(
                new CertificateException("certificate invalid")));
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(
                new IOException("malformed response")));
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(
                new IllegalStateException("runtime failure")));
    }

    @Test
    public void traversesNestedCausesButExplicitDenialsWin() {
        assertTrue(OfflineFallbackPolicy.canUseSnapshot(
                new IOException("request failed", new ConnectException("refused"))));

        SocketException socket = new SocketException("socket closed");
        socket.initCause(new SSLException("TLS close failure"));
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(socket));
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(
                new RuntimeException("wrapper", new ConnectException("refused"))));
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(
                new IOException("TLS wrapper", new CertificateException("wrong certificate"))));
    }

    @Test
    public void boundsTraversalAndStopsOnCauseCycles() {
        Throwable tooDeep = new ConnectException("refused");
        for (int index = 0; index < 32; index++) {
            tooDeep = new IOException("wrapper " + index, tooDeep);
        }
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(tooDeep));

        IOException first = new IOException("first");
        IOException second = new IOException("second");
        first.initCause(second);
        second.initCause(first);
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(first));
    }

    @Test
    public void failsClosedWhenCauseTraversalThrows() {
        IOException hostile = new IOException("hostile") {
            @Override
            public synchronized Throwable getCause() {
                throw new IllegalStateException("cause unavailable");
            }
        };
        assertFalse(OfflineFallbackPolicy.canUseSnapshot(hostile));
    }
}
