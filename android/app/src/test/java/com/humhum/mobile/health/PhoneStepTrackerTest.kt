package com.humhum.mobile.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PhoneStepTrackerTest {
    private val zone = ZoneId.of("Asia/Shanghai")
    private val day = LocalDate.of(2026, 7, 18)

    @Test
    fun firstObservationUsesSinceBootEstimateWhenBootWasToday() {
        val store = MemoryCheckpointStore()
        val tracker = PhoneStepTracker(store, zone)

        val estimate = tracker.observe(
            day = day,
            cumulativeSteps = 1_200.0,
            elapsedRealtimeMillis = 2 * HOUR_MILLIS,
            observedAt = Instant.parse("2026-07-18T02:00:00Z"),
        )

        assertEquals(1_200.0, estimate ?: -1.0, 0.0)
        assertEquals(0.0, store.checkpoint?.dayBaselineSteps ?: -1.0, 0.0)
    }

    @Test
    fun firstObservationBeforeKnownDayBoundaryStartsAnHonestEstimateCursor() {
        val store = MemoryCheckpointStore()
        val tracker = PhoneStepTracker(store, zone)

        val first = tracker.observe(
            day = day,
            cumulativeSteps = 8_000.0,
            elapsedRealtimeMillis = 36 * HOUR_MILLIS,
            observedAt = Instant.parse("2026-07-18T02:00:00Z"),
        )
        val second = tracker.observe(
            day = day,
            cumulativeSteps = 8_075.0,
            elapsedRealtimeMillis = 36 * HOUR_MILLIS + 30 * 60_000,
            observedAt = Instant.parse("2026-07-18T02:30:00Z"),
        )

        assertNull(first)
        assertEquals(75.0, second ?: -1.0, 0.0)
    }

    @Test
    fun processRecreationContinuesFromTheEncryptedCheckpoint() {
        val store = MemoryCheckpointStore()
        PhoneStepTracker(store, zone).observe(
            day = day,
            cumulativeSteps = 600.0,
            elapsedRealtimeMillis = HOUR_MILLIS,
            observedAt = Instant.parse("2026-07-18T01:00:00Z"),
        )

        val afterRecreation = PhoneStepTracker(store, zone).observe(
            day = day,
            cumulativeSteps = 680.0,
            elapsedRealtimeMillis = 2 * HOUR_MILLIS,
            observedAt = Instant.parse("2026-07-18T02:00:00Z"),
        )

        assertEquals(680.0, afterRecreation ?: -1.0, 0.0)
    }

    @Test
    fun dayRolloverCarriesTheLastCumulativeCheckpointAsAnEstimateBaseline() {
        val store = MemoryCheckpointStore(
            PhoneStepCheckpoint(
                day = day.minusDays(1),
                dayBaselineSteps = 2_000.0,
                lastCumulativeSteps = 2_900.0,
                elapsedRealtimeMillis = 30 * HOUR_MILLIS,
                observedAt = Instant.parse("2026-07-17T15:50:00Z"),
            ),
        )
        val tracker = PhoneStepTracker(store, zone)

        val firstToday = tracker.observe(
            day = day,
            cumulativeSteps = 3_020.0,
            elapsedRealtimeMillis = 31 * HOUR_MILLIS,
            observedAt = Instant.parse("2026-07-17T17:00:00Z"),
        )
        val laterToday = tracker.observe(
            day = day,
            cumulativeSteps = 3_100.0,
            elapsedRealtimeMillis = 32 * HOUR_MILLIS,
            observedAt = Instant.parse("2026-07-17T18:00:00Z"),
        )

        assertEquals(120.0, firstToday ?: -1.0, 0.0)
        assertEquals(200.0, laterToday ?: -1.0, 0.0)
        assertEquals(2_900.0, store.checkpoint?.dayBaselineSteps ?: -1.0, 0.0)
    }

    @Test
    fun rebootOrCounterDecreaseResetsWithoutMixingThePreviousBoot() {
        val store = MemoryCheckpointStore(
            PhoneStepCheckpoint(
                day = day,
                dayBaselineSteps = 1_000.0,
                lastCumulativeSteps = 1_400.0,
                elapsedRealtimeMillis = 20 * HOUR_MILLIS,
                observedAt = Instant.parse("2026-07-18T00:00:00Z"),
            ),
        )
        val tracker = PhoneStepTracker(store, zone)

        val afterReboot = tracker.observe(
            day = day,
            cumulativeSteps = 40.0,
            elapsedRealtimeMillis = HOUR_MILLIS,
            observedAt = Instant.parse("2026-07-18T02:00:00Z"),
        )
        val later = tracker.observe(
            day = day,
            cumulativeSteps = 65.0,
            elapsedRealtimeMillis = 2 * HOUR_MILLIS,
            observedAt = Instant.parse("2026-07-18T03:00:00Z"),
        )

        assertEquals(40.0, afterReboot ?: -1.0, 0.0)
        assertEquals(65.0, later ?: -1.0, 0.0)
        assertEquals(0.0, store.checkpoint?.dayBaselineSteps ?: -1.0, 0.0)
    }

    private class MemoryCheckpointStore(
        initial: PhoneStepCheckpoint? = null,
    ) : PhoneStepCheckpointStore {
        var checkpoint = initial

        override fun read(): PhoneStepCheckpoint? = checkpoint

        override fun write(checkpoint: PhoneStepCheckpoint) {
            this.checkpoint = checkpoint
        }
    }

    companion object {
        private const val HOUR_MILLIS = 60 * 60_000L
    }
}
