package com.humhum.mobile.health

import java.io.IOException
import java.time.Instant

const val MAX_HEALTH_SIGNAL_BATCH_SIZE = 31

fun interface HealthSignalTransport {
    @Throws(IOException::class)
    fun upload(signals: List<HealthSignal>): UploadResponse
}

data class UploadResponse(val imported: Int, val duplicates: Int) {
    init {
        require(imported >= 0 && duplicates >= 0) { "Upload response is invalid" }
    }
}

enum class UploadRoute { DIRECT, RELAY }

data class HealthSignalConnection(
    val direct: HealthSignalTransport? = null,
    val relay: HealthSignalTransport? = null,
    val preferRelay: Boolean = false,
)

data class SyncResult(
    val delivered: Boolean,
    val incomplete: Boolean = false,
    val route: UploadRoute? = null,
    val imported: Int = 0,
    val duplicates: Int = 0,
    val error: String? = null,
)

interface PendingHealthSignalQueue {
    fun peekBatch(limit: Int, now: Instant): List<HealthSignal>
    fun peekBatch(limit: Int = MAX_HEALTH_SIGNAL_BATCH_SIZE): List<HealthSignal> =
        peekBatch(limit, Instant.now())
    fun acknowledge(sourceIds: Collection<String>)
}

class HealthSignalUploader {
    fun sync(connection: HealthSignalConnection, signals: List<HealthSignal>): SyncResult {
        require(signals.size <= MAX_HEALTH_SIGNAL_BATCH_SIZE) {
            "Health signal batch must contain at most $MAX_HEALTH_SIGNAL_BATCH_SIZE records"
        }
        if (signals.isEmpty()) return SyncResult(delivered = true)

        var lastError: IOException? = null
        for ((route, transport) in transports(connection)) {
            try {
                val response = transport.upload(signals)
                val accounted = response.imported + response.duplicates
                if (accounted != signals.size) {
                    return SyncResult(
                        delivered = false,
                        incomplete = true,
                        route = route,
                        imported = response.imported,
                        duplicates = response.duplicates,
                        error = "Mac acknowledged $accounted of ${signals.size} health signals",
                    )
                }
                return SyncResult(
                    delivered = true,
                    route = route,
                    imported = response.imported,
                    duplicates = response.duplicates,
                )
            } catch (error: IOException) {
                lastError = error
            }
        }
        return SyncResult(
            delivered = false,
            error = lastError?.message ?: "No private HUMHUM route is available",
        )
    }

    fun syncPending(
        connection: HealthSignalConnection,
        queue: PendingHealthSignalQueue,
        now: Instant = Instant.now(),
    ): SyncResult {
        val batch = queue.peekBatch(MAX_HEALTH_SIGNAL_BATCH_SIZE, now)
        val result = sync(connection, batch)
        if (result.delivered && batch.isNotEmpty()) {
            queue.acknowledge(batch.map(HealthSignal::sourceId))
        }
        return result
    }

    private fun transports(connection: HealthSignalConnection): List<Pair<UploadRoute, HealthSignalTransport>> {
        val first = if (connection.preferRelay) {
            listOf(UploadRoute.RELAY to connection.relay, UploadRoute.DIRECT to connection.direct)
        } else {
            listOf(UploadRoute.DIRECT to connection.direct, UploadRoute.RELAY to connection.relay)
        }
        return first.mapNotNull { (route, transport) -> transport?.let { route to it } }
    }
}
