package com.humhum.mobile.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
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

    @Test
    fun signalRejectsSourceIdsThatDoNotMatchItsSourceMetricAndLocalDay() {
        val day = LocalDate.of(2026, 7, 17)
        val startsAt = day.atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant()
        try {
            HealthSignal(
                sourceId = "health-connect:sleep:2026-07-17",
                metric = HealthMetric.STEPS,
                value = 1.0,
                source = HealthSource.HEALTH_CONNECT,
                startedAt = startsAt,
                endedAt = day.plusDays(1).atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant(),
                capturedAt = startsAt,
            )
            throw AssertionError("Expected source id validation")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }

    @Test
    fun signalJsonRetainsTheExplicitPhoneLocalDayWithoutAssumingUtc() {
        val day = LocalDate.of(2026, 7, 17)
        val zone = ZoneId.of("Asia/Shanghai")
        val signal = HealthSignal.forLocalDay(
            metric = HealthMetric.STEPS,
            value = 2.0,
            source = HealthSource.HEALTH_CONNECT,
            day = day,
            zone = zone,
            capturedAt = Instant.parse("2026-07-17T17:00:00Z"),
        )

        val restored = HealthSignal.fromJson(signal.toJson())

        assertEquals(day, restored.localDay)
        assertEquals("health-connect:steps:2026-07-17", restored.sourceId)
        assertEquals(Instant.parse("2026-07-16T16:00:00Z"), restored.startedAt)
    }

    @Test
    fun malformedSourceIdDateIsRejectedWhenRestoringJson() {
        val signal = HealthSignal.forLocalDay(
            HealthMetric.STEPS,
            2.0,
            HealthSource.HEALTH_CONNECT,
            LocalDate.of(2026, 7, 17),
            ZoneId.of("Asia/Shanghai"),
            Instant.parse("2026-07-17T17:00:00Z"),
        )
        val json = signal.toJson().put("source_id", "health-connect:steps:2026-7-17")
        try {
            HealthSignal.fromJson(json)
            throw AssertionError("Expected canonical source id validation")
        } catch (_: IllegalArgumentException) {
            // Expected.
        }
    }
}
