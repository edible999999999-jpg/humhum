package com.humhum.mobile.health

import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneStepCheckpointCodecTest {
    @Test
    fun legacyVersionOneDefaultsTheCarriedSegmentToZero() {
        val legacy = """
            {
              "version": 1,
              "day": "2026-07-18",
              "day_baseline_steps": 100.0,
              "last_cumulative_steps": 450.0,
              "elapsed_realtime_millis": 3600000,
              "observed_at": "2026-07-18T02:00:00Z"
            }
        """.trimIndent().toByteArray()

        val checkpoint = PhoneStepCheckpointCodec.decode(legacy)

        assertEquals(0.0, checkpoint.carriedDailySteps, 0.0)
        assertEquals(350.0, checkpoint.lastCumulativeSteps - checkpoint.dayBaselineSteps, 0.0)
    }

    @Test
    fun currentVersionRoundTripsCarriedDailySteps() {
        val checkpoint = PhoneStepCheckpoint(
            day = LocalDate.of(2026, 7, 18),
            carriedDailySteps = 725.0,
            dayBaselineSteps = 0.0,
            lastCumulativeSteps = 80.0,
            elapsedRealtimeMillis = 900_000L,
            observedAt = Instant.parse("2026-07-18T04:00:00Z"),
        )

        assertEquals(
            checkpoint,
            PhoneStepCheckpointCodec.decode(PhoneStepCheckpointCodec.encode(checkpoint)),
        )
    }
}
