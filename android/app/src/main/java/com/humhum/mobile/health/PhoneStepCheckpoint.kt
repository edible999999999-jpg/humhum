package com.humhum.mobile.health

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

data class PhoneStepCheckpoint(
    val day: LocalDate,
    val dayBaselineSteps: Double,
    val lastCumulativeSteps: Double,
    val elapsedRealtimeMillis: Long,
    val observedAt: Instant,
) {
    init {
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
            elapsedRealtimeMillis >= previous.elapsedRealtimeMillis &&
            !observedAt.isBefore(previous.observedAt)

        val baseline = when {
            previous == null || !sameBoot || day.isBefore(previous.day) -> {
                initialBaseline(day, cumulativeSteps, elapsedRealtimeMillis, observedAt)
            }
            day == previous.day -> previous.dayBaselineSteps
            day == previous.day.plusDays(1) -> previous.lastCumulativeSteps
            else -> initialBaseline(day, cumulativeSteps, elapsedRealtimeMillis, observedAt)
        }
        val checkpoint = PhoneStepCheckpoint(
            day = day,
            dayBaselineSteps = baseline,
            lastCumulativeSteps = cumulativeSteps,
            elapsedRealtimeMillis = elapsedRealtimeMillis,
            observedAt = observedAt,
        )
        store.write(checkpoint)

        val unknownDayStart = baseline == cumulativeSteps &&
            (previous == null || !sameBoot || day != previous.day.plusDays(1))
        return if (unknownDayStart) null else (cumulativeSteps - baseline).coerceAtLeast(0.0)
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
