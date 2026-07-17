package com.humhum.mobile.health

import java.io.IOException
import java.time.Instant
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthTransportAdaptersTest {
    @Test
    fun transientQueueReadFailureRequestsRetryWithoutDroppingTheQueue() {
        var acknowledged = false
        val queue = object : HealthSignalBuffer {
            override fun enqueue(signals: Collection<HealthSignal>, now: Instant) = Unit

            override fun peekBatch(limit: Int, now: Instant): List<HealthSignal> {
                throw HealthQueueUnavailableException(
                    "queue unavailable",
                    IOException("disk busy"),
                )
            }

            override fun acknowledge(sourceIds: Collection<String>) {
                acknowledged = true
            }
        }
        val sink = QueuedHealthSignalSink(
            queue = queue,
            connectionProvider = HealthSignalConnectionProvider {
                HealthSignalConnection(
                    direct = HealthSignalTransport { UploadResponse(0, 0) },
                )
            },
        )

        val delivery = sink.sync()

        assertTrue(delivery.queueUnavailable)
        assertTrue(delivery.transientFailure)
        assertFalse(acknowledged)
    }
}
