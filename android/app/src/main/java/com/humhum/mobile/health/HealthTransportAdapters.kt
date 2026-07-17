package com.humhum.mobile.health

import android.content.Context
import com.humhum.mobile.AnywhereGateway
import com.humhum.mobile.AnywhereRelayClient
import com.humhum.mobile.AnywhereStateStore
import com.humhum.mobile.ConnectionStore
import com.humhum.mobile.MobileProtocol
import java.time.Instant
import org.json.JSONArray

fun interface HealthSignalConnectionProvider {
    fun current(): HealthSignalConnection
}

class AndroidHealthSignalConnectionProvider(
    private val context: Context,
) : HealthSignalConnectionProvider {
    override fun current(): HealthSignalConnection {
        val connection = ConnectionStore(
            context.getSharedPreferences("humhum_connection", Context.MODE_PRIVATE),
        ).load() ?: return HealthSignalConnection()
        val direct = HealthSignalTransport { signals ->
            try {
                val result = MobileProtocol(
                    connection.config(),
                    connection.token(),
                    connection.scope(),
                ).uploadSignals(signals.toJsonArray())
                UploadResponse(result.imported(), result.duplicates())
            } catch (error: Exception) {
                throw HealthTransportRetryPolicy.asTransportException(
                    error,
                    "Direct health upload",
                )
            }
        }
        val relayConfig = connection.wakeRelay()
        val relay = if (relayConfig?.version() == 2) {
            HealthSignalTransport { signals ->
                try {
                    val gateway = AnywhereGateway(
                        AnywhereRelayClient(),
                        AnywhereStateStore(
                            context.getSharedPreferences(
                                "humhum_anywhere",
                                Context.MODE_PRIVATE,
                            ),
                        ),
                    )
                    val result = gateway.uploadSignals(relayConfig, signals.toJsonArray())
                    UploadResponse(result.imported(), result.duplicates())
                } catch (error: Exception) {
                    throw HealthTransportRetryPolicy.asTransportException(
                        error,
                        "Anywhere health upload",
                    )
                }
            }
        } else {
            null
        }
        return HealthSignalConnection(
            direct = direct,
            relay = relay,
            preferRelay = connection.prefersRelay(),
        )
    }

    private fun List<HealthSignal>.toJsonArray(): JSONArray = JSONArray().also { values ->
        forEach { values.put(it.toJson()) }
    }
}

interface HealthSignalBuffer : PendingHealthSignalQueue {
    fun enqueue(signals: Collection<HealthSignal>, now: Instant)
}

class EncryptedHealthSignalBuffer(
    private val queue: EncryptedHealthQueue,
) : HealthSignalBuffer {
    override fun enqueue(signals: Collection<HealthSignal>, now: Instant) {
        queue.enqueue(signals, now)
    }

    override fun peekBatch(limit: Int, now: Instant): List<HealthSignal> =
        queue.peekBatch(limit, now)

    override fun acknowledge(sourceIds: Collection<String>) {
        queue.acknowledge(sourceIds)
    }
}

class QueuedHealthSignalSink(
    private val queue: HealthSignalBuffer,
    private val connectionProvider: HealthSignalConnectionProvider,
    private val uploader: HealthSignalUploader = HealthSignalUploader(),
) : HealthSignalSink {
    override fun enqueue(signals: Collection<HealthSignal>, now: Instant) {
        queue.enqueue(signals, now)
    }

    override fun sync(): HealthDelivery {
        val connection = connectionProvider.current()
        val hasRoute = connection.direct != null || connection.relay != null
        if (!hasRoute) return HealthDelivery()
        return try {
            val result = uploader.syncPending(connection, queue)
            HealthDelivery(result = result)
        } catch (_: HealthQueueUnavailableException) {
            HealthDelivery(queueUnavailable = true)
        } catch (_: RuntimeException) {
            HealthDelivery()
        }
    }
}
