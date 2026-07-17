package com.humhum.mobile.health

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import kotlinx.coroutines.CancellationException

class HealthConnectDataSource(
    private val client: HealthConnectClient,
    private val zone: ZoneId = ZoneId.systemDefault(),
    private val clock: () -> Instant = Instant::now,
) : HealthDataSource {
    override val source = HealthSource.HEALTH_CONNECT

    override suspend fun readDay(
        day: LocalDate,
        metrics: Set<HealthMetric>,
    ): HealthSummary {
        val values = linkedMapOf<HealthMetric, Double?>()
        for (metric in metrics) {
            values[metric] = readGranted(metric, day)
        }
        val hasValue = values.values.any { it != null }
        return HealthSummary(
            steps = values[HealthMetric.STEPS],
            restingHeartRate = values[HealthMetric.RESTING_HEART_RATE],
            sleepMinutes = values[HealthMetric.SLEEP],
            capturedAt = if (hasValue) clock() else null,
            sourceStates = HealthMetric.entries.associateWith { metric ->
                when {
                    metric !in metrics -> HealthSourceState.DISABLED
                    values[metric] != null -> HealthSourceState.HEALTH_CONNECT
                    else -> HealthSourceState.UNAVAILABLE
                }
            },
        )
    }

    private suspend fun readGranted(metric: HealthMetric, day: LocalDate): Double? {
        val permission = HealthPermissionController.permissionsFor(metric).single()
        if (permission !in client.permissionController.getGrantedPermissions()) return null
        return try {
            when (metric) {
                HealthMetric.STEPS -> readSteps(day)
                HealthMetric.RESTING_HEART_RATE -> readLatestRestingHeartRate(day)
                HealthMetric.SLEEP -> readPreviousNightSleep(day)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            null
        }
    }

    private suspend fun readSteps(day: LocalDate): Double? {
        val (start, end) = dayBounds(day)
        val result = client.aggregate(
            AggregateRequest(
                metrics = setOf(StepsRecord.COUNT_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(start, end),
            ),
        )
        return result[StepsRecord.COUNT_TOTAL]?.toDouble()
    }

    private suspend fun readLatestRestingHeartRate(day: LocalDate): Double? {
        val (start, end) = dayBounds(day)
        return client.readRecords(
            ReadRecordsRequest(
                recordType = RestingHeartRateRecord::class,
                timeRangeFilter = TimeRangeFilter.between(start, end),
                ascendingOrder = false,
                pageSize = 1,
            ),
        ).records.firstOrNull()?.beatsPerMinute?.toDouble()
    }

    private suspend fun readPreviousNightSleep(day: LocalDate): Double? {
        val start = day.minusDays(1).atTime(LocalTime.NOON).atZone(zone).toInstant()
        val end = day.atTime(LocalTime.NOON).atZone(zone).toInstant()
        val result = client.aggregate(
            AggregateRequest(
                metrics = setOf(SleepSessionRecord.SLEEP_DURATION_TOTAL),
                timeRangeFilter = TimeRangeFilter.between(start, end),
            ),
        )
        return result[SleepSessionRecord.SLEEP_DURATION_TOTAL]?.toMinutes()?.toDouble()
    }

    private fun dayBounds(day: LocalDate): Pair<Instant, Instant> =
        day.atStartOfDay(zone).toInstant() to day.plusDays(1).atStartOfDay(zone).toInstant()
}
