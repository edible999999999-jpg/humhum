package com.humhum.mobile.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class PhoneStepCheckpoint(
    val day: LocalDate,
    val carriedDailySteps: Double = 0.0,
    val dayBaselineSteps: Double,
    val lastCumulativeSteps: Double,
    val elapsedRealtimeMillis: Long,
    val observedAt: Instant,
) {
    init {
        require(carriedDailySteps.isFinite() && carriedDailySteps >= 0.0) {
            "Carried phone steps are invalid"
        }
        require(dayBaselineSteps.isFinite() && dayBaselineSteps >= 0.0) {
            "Phone step baseline is invalid"
        }
        require(lastCumulativeSteps.isFinite() && lastCumulativeSteps >= dayBaselineSteps) {
            "Phone step total is invalid"
        }
        require(elapsedRealtimeMillis >= 0L) { "Phone step elapsed time is invalid" }
    }
}

interface PhoneStepCheckpointStore {
    fun read(): PhoneStepCheckpoint?
    fun write(checkpoint: PhoneStepCheckpoint)
}

class PhoneStepTracker(
    private val store: PhoneStepCheckpointStore,
    private val zone: ZoneId,
) {
    fun observe(
        day: LocalDate,
        cumulativeSteps: Double,
        elapsedRealtimeMillis: Long,
        observedAt: Instant,
    ): Double? {
        if (!cumulativeSteps.isFinite() || cumulativeSteps < 0.0 || elapsedRealtimeMillis < 0L) {
            return null
        }

        val previous = store.read()
        val sameBoot = previous != null &&
            cumulativeSteps >= previous.lastCumulativeSteps &&
            elapsedRealtimeMillis >= previous.elapsedRealtimeMillis

        val carriedDailySteps: Double
        val baseline: Double
        when {
            previous == null || day.isBefore(previous.day) -> {
                carriedDailySteps = 0.0
                baseline = initialBaseline(day, cumulativeSteps, elapsedRealtimeMillis, observedAt)
            }
            day == previous.day && sameBoot -> {
                carriedDailySteps = previous.carriedDailySteps
                baseline = previous.dayBaselineSteps
            }
            day == previous.day -> {
                carriedDailySteps = previous.carriedDailySteps +
                    (previous.lastCumulativeSteps - previous.dayBaselineSteps)
                baseline = 0.0
            }
            day == previous.day.plusDays(1) && sameBoot -> {
                carriedDailySteps = 0.0
                baseline = previous.lastCumulativeSteps
            }
            else -> {
                carriedDailySteps = 0.0
                baseline = initialBaseline(day, cumulativeSteps, elapsedRealtimeMillis, observedAt)
            }
        }
        val checkpoint = PhoneStepCheckpoint(
            day = day,
            carriedDailySteps = carriedDailySteps,
            dayBaselineSteps = baseline,
            lastCumulativeSteps = cumulativeSteps,
            elapsedRealtimeMillis = elapsedRealtimeMillis,
            observedAt = observedAt,
        )
        store.write(checkpoint)

        val unknownDayStart = baseline == cumulativeSteps &&
            carriedDailySteps == 0.0 &&
            (previous == null || day != previous.day || !sameBoot)
        return if (unknownDayStart) {
            null
        } else {
            carriedDailySteps + (cumulativeSteps - baseline).coerceAtLeast(0.0)
        }
    }

    private fun initialBaseline(
        day: LocalDate,
        cumulativeSteps: Double,
        elapsedRealtimeMillis: Long,
        observedAt: Instant,
    ): Double {
        val bootAt = observedAt.minusMillis(elapsedRealtimeMillis)
        val dayStart = day.atStartOfDay(zone).toInstant()
        return if (!bootAt.isBefore(dayStart)) 0.0 else cumulativeSteps
    }
}
