package com.humhum.mobile.health

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException

enum class SyncTrigger {
    FOREGROUND,
    BACKGROUND,
}

enum class HealthFreshness {
    FRESH,
    STALE,
    EMPTY,
}

data class HealthUiState(
    val summary: HealthSummary,
    val freshness: HealthFreshness,
    val notices: List<String>,
    val enqueuedSignals: Int,
    val delivery: HealthDelivery = HealthDelivery(),
)

class HealthRepository(
    private val planProvider: HealthPlanProvider,
    private val healthConnectSource: HealthDataSource?,
    private val phoneStepSource: HealthDataSource?,
    private val signalSink: HealthSignalSink,
    private val dayProvider: () -> LocalDate = { LocalDate.now() },
    private val clock: () -> Instant = Instant::now,
    private val zone: ZoneId = ZoneId.systemDefault(),
) {
    suspend fun refresh(trigger: SyncTrigger): HealthUiState {
        val plan = planProvider.plan(trigger)
        val requested = if (trigger == SyncTrigger.BACKGROUND) {
            plan.backgroundMetrics
        } else {
            plan.foregroundMetrics
        }
        val notices = mutableListOf<String>()
        val day = dayProvider()
        val summaries = mutableListOf<Pair<HealthSource, HealthSummary>>()

        val healthConnectMetrics = requested.filterTo(linkedSetOf()) {
            plan.sourceFor(it) == HealthSource.HEALTH_CONNECT
        }
        readSource(
            source = healthConnectSource,
            day = day,
            metrics = healthConnectMetrics,
            summaries = summaries,
            notices = notices,
        )

        val phoneMetrics = requested.filterTo(linkedSetOf()) {
            plan.sourceFor(it) == HealthSource.PHONE_STEP_COUNTER
        }.intersect(setOf(HealthMetric.STEPS))
        readSource(
            source = phoneStepSource,
            day = day,
            metrics = phoneMetrics,
            summaries = summaries,
            notices = notices,
        )

        val summary = merge(plan, requested, summaries)
        val capturedAt = summary.capturedAt
        val freshness = when {
            capturedAt == null -> HealthFreshness.EMPTY
            Duration.between(capturedAt, clock()) > STALE_AFTER -> HealthFreshness.STALE
            else -> HealthFreshness.FRESH
        }
        val signals = signalsFor(day, summary, plan, requested, capturedAt)
        if (signals.isNotEmpty()) signalSink.enqueue(signals, clock())
        val delivery = if (requested.isEmpty()) HealthDelivery() else signalSink.sync()
        return HealthUiState(
            summary = summary,
            freshness = freshness,
            notices = notices,
            enqueuedSignals = signals.size,
            delivery = delivery,
        )
    }

    private suspend fun readSource(
        source: HealthDataSource?,
        day: LocalDate,
        metrics: Set<HealthMetric>,
        summaries: MutableList<Pair<HealthSource, HealthSummary>>,
        notices: MutableList<String>,
    ) {
        if (metrics.isEmpty()) return
        if (source == null) {
            notices += "Health source is unavailable"
            return
        }
        try {
            summaries += source.source to source.readDay(day, metrics)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            notices += (error.message ?: "Health source could not be read")
        }
    }

    private fun merge(
        plan: HealthSourcePlan,
        requested: Set<HealthMetric>,
        summaries: List<Pair<HealthSource, HealthSummary>>,
    ): HealthSummary {
        fun value(metric: HealthMetric): Double? {
            val expected = plan.sourceFor(metric) ?: return null
            val sourceSummary = summaries.firstOrNull { it.first == expected }?.second ?: return null
            return when (metric) {
                HealthMetric.STEPS -> sourceSummary.steps
                HealthMetric.RESTING_HEART_RATE -> sourceSummary.restingHeartRate
                HealthMetric.SLEEP -> sourceSummary.sleepMinutes
            }
        }

        val values = HealthMetric.entries.associateWith { metric ->
            if (metric in requested) value(metric) else null
        }
        val capturedAt = summaries.mapNotNull { it.second.capturedAt }.maxOrNull()
        return HealthSummary(
            steps = values[HealthMetric.STEPS],
            restingHeartRate = values[HealthMetric.RESTING_HEART_RATE],
            sleepMinutes = values[HealthMetric.SLEEP],
            capturedAt = capturedAt,
            sourceStates = plan.sourceStates,
        )
    }

    private fun signalsFor(
        day: LocalDate,
        summary: HealthSummary,
        plan: HealthSourcePlan,
        requested: Set<HealthMetric>,
        capturedAt: Instant?,
    ): List<HealthSignal> {
        if (capturedAt == null) return emptyList()
        return HealthMetric.entries.mapNotNull { metric ->
            if (metric !in requested) return@mapNotNull null
            val value = when (metric) {
                HealthMetric.STEPS -> summary.steps
                HealthMetric.RESTING_HEART_RATE -> summary.restingHeartRate
                HealthMetric.SLEEP -> summary.sleepMinutes
            } ?: return@mapNotNull null
            val source = plan.sourceFor(metric) ?: return@mapNotNull null
            HealthSignal.forLocalDay(metric, value, source, day, zone, capturedAt)
        }
    }

    companion object {
        private val STALE_AFTER = Duration.ofHours(6)
    }
}
