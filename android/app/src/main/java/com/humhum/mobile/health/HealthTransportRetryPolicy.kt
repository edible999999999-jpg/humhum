package com.humhum.mobile.health

import com.humhum.mobile.AnywhereRelayClient
import com.humhum.mobile.MobileProtocol
import java.io.IOException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.GeneralSecurityException
import java.util.Collections
import java.util.IdentityHashMap
import javax.net.ssl.SSLException
import org.json.JSONException

sealed class HealthTransportException(
    message: String,
    cause: Throwable? = null,
    val retryable: Boolean,
) : IOException(message, cause)

class TransientHealthTransportException(
    message: String,
    cause: Throwable? = null,
) : HealthTransportException(message, cause, retryable = true)

class PermanentHealthTransportException(
    message: String,
    cause: Throwable? = null,
) : HealthTransportException(message, cause, retryable = false)

object HealthTransportRetryPolicy {
    private val retryableStatuses = setOf(500, 502, 503, 504)

    fun asTransportException(error: Throwable, operation: String): HealthTransportException {
        if (error is HealthTransportException) return error
        val message = error.message?.takeIf(String::isNotBlank) ?: "$operation failed"
        return if (isTransient(error)) {
            TransientHealthTransportException(message, error)
        } else {
            PermanentHealthTransportException(message, error)
        }
    }

    fun isTransient(error: Throwable): Boolean {
        val visited = Collections.newSetFromMap(IdentityHashMap<Throwable, Boolean>())
        var current: Throwable? = error
        var networkFailure = false
        while (current != null && visited.add(current)) {
            when (current) {
                is HealthTransportException -> return current.retryable
                is MobileProtocol.HttpStatusException -> {
                    return current.status() in retryableStatuses
                }
                is AnywhereRelayClient.RelayStatusException -> {
                    return current.status() in retryableStatuses
                }
                is SSLException,
                is GeneralSecurityException,
                is JSONException,
                is IllegalArgumentException,
                -> return false
                is ConnectException,
                is UnknownHostException,
                is NoRouteToHostException,
                is SocketTimeoutException,
                is SocketException,
                -> networkFailure = true
            }
            current = current.cause
        }
        return networkFailure
    }
}
