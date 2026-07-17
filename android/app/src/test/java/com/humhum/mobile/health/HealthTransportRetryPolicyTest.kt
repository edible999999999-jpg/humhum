package com.humhum.mobile.health

import com.humhum.mobile.MobileProtocol
import java.io.IOException
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import org.json.JSONException
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthTransportRetryPolicyTest {
    @Test
    fun retriesOnlyConnectivityTimeoutAndSelectedServerFailures() {
        assertTrue(HealthTransportRetryPolicy.isTransient(ConnectException("refused")))
        assertTrue(HealthTransportRetryPolicy.isTransient(UnknownHostException("offline")))
        assertTrue(HealthTransportRetryPolicy.isTransient(SocketTimeoutException("timeout")))
        assertTrue(HealthTransportRetryPolicy.isTransient(SocketException("reset")))
        assertTrue(
            HealthTransportRetryPolicy.isTransient(
                MobileProtocol.HttpStatusException(503, "unavailable"),
            ),
        )
        assertFalse(
            HealthTransportRetryPolicy.isTransient(
                MobileProtocol.HttpStatusException(501, "not implemented"),
            ),
        )
    }

    @Test
    fun authenticationParsingValidationAndGenericIoArePermanent() {
        assertFalse(
            HealthTransportRetryPolicy.isTransient(
                MobileProtocol.HttpStatusException(401, "revoked"),
            ),
        )
        assertFalse(
            HealthTransportRetryPolicy.isTransient(
                MobileProtocol.HttpStatusException(403, "forbidden"),
            ),
        )
        assertFalse(HealthTransportRetryPolicy.isTransient(JSONException("malformed")))
        assertFalse(HealthTransportRetryPolicy.isTransient(IOException("invalid response")))
        assertFalse(HealthTransportRetryPolicy.isTransient(IllegalArgumentException("invalid")))
    }
}
