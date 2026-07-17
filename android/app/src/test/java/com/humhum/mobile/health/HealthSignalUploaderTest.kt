package com.humhum.mobile.health

import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthSignalUploaderTest {
    private val signal = HealthSignal.forLocalDay(
        metric = HealthMetric.STEPS,
        value = 42.0,
        source = HealthSource.HEALTH_CONNECT,
        day = LocalDate.of(2026, 7, 17),
        zone = ZoneOffset.UTC,
        capturedAt = Instant.parse("2026-07-17T13:00:00Z"),
    )

    @Test
    fun syncUsesDirectBeforeRelayByDefault() {
        val direct = RecordingTransport(UploadResponse(imported = 1, duplicates = 0))
        val relay = RecordingTransport(UploadResponse(imported = 1, duplicates = 0))

        val result = HealthSignalUploader().sync(
            HealthSignalConnection(direct = direct, relay = relay),
            listOf(signal),
        )

        assertTrue(result.delivered)
        assertEquals(UploadRoute.DIRECT, result.route)
        assertEquals(1, direct.calls)
        assertEquals(0, relay.calls)
    }

    @Test
    fun syncFallsBackToRelayAfterDirectTransportFailure() {
        val direct = RecordingTransport(IOException("local Mac unavailable"))
        val relay = RecordingTransport(UploadResponse(imported = 1, duplicates = 0))

        val result = HealthSignalUploader().sync(
            HealthSignalConnection(direct = direct, relay = relay),
            listOf(signal),
        )

        assertTrue(result.delivered)
        assertEquals(UploadRoute.RELAY, result.route)
        assertEquals(1, direct.calls)
        assertEquals(1, relay.calls)
    }

    @Test
    fun relayPreferenceUsesRelayBeforeDirect() {
        val direct = RecordingTransport(UploadResponse(imported = 1, duplicates = 0))
        val relay = RecordingTransport(UploadResponse(imported = 1, duplicates = 0))

        val result = HealthSignalUploader().sync(
            HealthSignalConnection(direct = direct, relay = relay, preferRelay = true),
            listOf(signal),
        )

        assertTrue(result.delivered)
        assertEquals(UploadRoute.RELAY, result.route)
        assertEquals(0, direct.calls)
        assertEquals(1, relay.calls)
    }

    @Test
    fun pendingSignalsAreAcknowledgedOnlyAfterASuccessfulResponse() {
        val queue = RecordingQueue(listOf(signal))
        val failed = HealthSignalUploader().syncPending(
            HealthSignalConnection(direct = RecordingTransport(IOException("offline"))),
            queue,
        )

        assertFalse(failed.delivered)
        assertTrue(queue.acknowledged.isEmpty())

        val succeeded = HealthSignalUploader().syncPending(
            HealthSignalConnection(direct = RecordingTransport(UploadResponse(1, 0))),
            queue,
        )

        assertTrue(succeeded.delivered)
        assertEquals(listOf(signal.sourceId), queue.acknowledged)
    }

    @Test
    fun partialResponseRemainsQueuedAndIsReportedAsIncomplete() {
        val queue = RecordingQueue(listOf(signal))

        val result = HealthSignalUploader().syncPending(
            HealthSignalConnection(direct = RecordingTransport(UploadResponse(0, 0))),
            queue,
        )

        assertFalse(result.delivered)
        assertTrue(result.incomplete)
        assertEquals(UploadRoute.DIRECT, result.route)
        assertTrue(queue.acknowledged.isEmpty())
        assertEquals(listOf(signal), queue.peekBatch(31))
    }

    @Test
    fun responseMustAccountForEverySignalBeforeItIsDelivered() {
        val second = HealthSignal.forLocalDay(
            metric = HealthMetric.STEPS,
            value = 43.0,
            source = HealthSource.HEALTH_CONNECT,
            day = LocalDate.of(2026, 7, 18),
            zone = ZoneOffset.UTC,
            capturedAt = Instant.parse("2026-07-18T13:00:00Z"),
        )

        val result = HealthSignalUploader().sync(
            HealthSignalConnection(direct = RecordingTransport(UploadResponse(imported = 1, duplicates = 0))),
            listOf(signal, second),
        )

        assertFalse(result.delivered)
        assertTrue(result.incomplete)
    }

    @Test
    fun batchesAreNeverLargerThanThirtyOneSignals() {
        val signals = (1..32).map { index ->
            HealthSignal.forLocalDay(
                metric = HealthMetric.STEPS,
                value = index.toDouble(),
                source = HealthSource.HEALTH_CONNECT,
                day = LocalDate.of(2026, 1, 1).plusDays(index.toLong()),
                zone = ZoneOffset.UTC,
                capturedAt = Instant.parse("2026-07-17T13:00:00Z"),
            )
        }

        try {
            HealthSignalUploader().sync(
                HealthSignalConnection(direct = RecordingTransport(UploadResponse(31, 0))),
                signals,
            )
            throw AssertionError("Expected batch validation")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }

    private class RecordingTransport(private val answer: Any) : HealthSignalTransport {
        var calls = 0

        override fun upload(signals: List<HealthSignal>): UploadResponse {
            calls += 1
            if (answer is IOException) throw answer
            return answer as UploadResponse
        }
    }

    private class RecordingQueue(signals: List<HealthSignal>) : PendingHealthSignalQueue {
        private val values = signals.toMutableList()
        val acknowledged = mutableListOf<String>()

        override fun peekBatch(limit: Int, now: Instant): List<HealthSignal> = values.take(limit)

        override fun acknowledge(sourceIds: Collection<String>) {
            acknowledged += sourceIds
            values.removeAll { it.sourceId in sourceIds }
        }
    }
}
