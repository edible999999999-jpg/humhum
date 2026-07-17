package com.humhum.mobile.health

import android.content.Context
import com.humhum.mobile.AnywhereGateway
import com.humhum.mobile.AnywhereRelayClient
import com.humhum.mobile.AnywhereStateStore
import com.humhum.mobile.ConnectionStore
import com.humhum.mobile.MobileProtocol
import java.io.IOException
import org.json.JSONArray

class AndroidHealthSignalConnectionProvider(
    private val context: Context,
) {
    fun current(): HealthSignalConnection {
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
            } catch (error: IOException) {
                throw error
            } catch (error: Exception) {
                throw IOException("Direct health upload failed", error)
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
                } catch (error: IOException) {
                    throw error
                } catch (error: Exception) {
                    throw IOException("Anywhere health upload failed", error)
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

class QueuedHealthSignalSink(
    private val queue: EncryptedHealthQueue,
    private val connectionProvider: AndroidHealthSignalConnectionProvider,
    private val uploader: HealthSignalUploader = HealthSignalUploader(),
) : HealthSignalSink {
    override fun enqueue(signals: Collection<HealthSignal>, now: java.time.Instant) {
        queue.enqueue(signals, now)
    }

    override fun sync(): HealthDelivery {
        val connection = connectionProvider.current()
        val hasRoute = connection.direct != null || connection.relay != null
        if (!hasRoute) return HealthDelivery()
        return try {
            val result = uploader.syncPending(connection, queue)
            HealthDelivery(
                result = result,
                transientFailure = !result.delivered,
            )
        } catch (_: RuntimeException) {
            HealthDelivery(transientFailure = false)
        }
    }
}
