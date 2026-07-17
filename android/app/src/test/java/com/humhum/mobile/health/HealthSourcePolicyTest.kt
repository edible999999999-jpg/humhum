package com.humhum.mobile.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthSourcePolicyTest {
    @Test
    fun phoneStepCounterIsTheOnlyFallbackWhenHealthConnectIsUnavailable() {
        val plan = HealthSourcePolicy.plan(
            healthConnectAvailable = false,
            stepSensorAvailable = true,
            grants = setOf(HealthMetric.STEPS),
            backgroundGranted = false,
        )

        assertEquals(setOf(HealthMetric.STEPS), plan.foregroundMetrics)
        assertEquals(HealthSource.PHONE_STEP_COUNTER, plan.sourceFor(HealthMetric.STEPS))
        assertTrue(plan.backgroundMetrics.isEmpty())
    }

    @Test
    fun healthConnectWinsAndBackgroundRequiresItsSeparateGrant() {
        val plan = HealthSourcePolicy.plan(
            healthConnectAvailable = true,
            stepSensorAvailable = true,
            grants = HealthMetric.entries.toSet(),
            backgroundGranted = true,
        )

        assertEquals(HealthMetric.entries.toSet(), plan.foregroundMetrics)
        assertEquals(HealthMetric.entries.toSet(), plan.backgroundMetrics)
        assertEquals(HealthSource.HEALTH_CONNECT, plan.sourceFor(HealthMetric.SLEEP))
    }

    @Test
    fun dailySignalsUseStableSourceIdsAndLocalDayBoundaries() {
        val shanghai = ZoneId.of("Asia/Shanghai")
        val day = LocalDate.of(2026, 7, 17)
        val signal = HealthSignal.forLocalDay(
            metric = HealthMetric.STEPS,
            value = 6_342.0,
            source = HealthSource.HEALTH_CONNECT,
            day = day,
            zone = shanghai,
            capturedAt = Instant.parse("2026-07-17T17:00:00Z"),
        )

        assertEquals("health-connect:steps:2026-07-17", signal.sourceId)
        assertEquals(day.atStartOfDay(shanghai).toInstant(), signal.startedAt)
        assertEquals(day.plusDays(1).atStartOfDay(shanghai).toInstant(), signal.endedAt)

        val json = signal.toJson()
        assertEquals("health.steps.daily", json.getString("kind"))
        assertEquals("count", json.getString("unit"))
        assertEquals("health_connect", json.getString("source"))
        assertEquals(6_342.0, json.getDouble("value"), 0.0)
    }

    @Test
    fun signalRejectsNonDailyIntervalsAndInvalidValues() {
        val startsAt = Instant.parse("2026-07-17T00:00:00Z")
        try {
            HealthSignal(
                sourceId = "health-connect:steps:2026-07-17",
                metric = HealthMetric.STEPS,
                value = Double.NaN,
                source = HealthSource.HEALTH_CONNECT,
                startedAt = startsAt,
                endedAt = startsAt.plusSeconds(60),
                capturedAt = startsAt.plusSeconds(60),
            )
            throw AssertionError("Expected value validation")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }
}
