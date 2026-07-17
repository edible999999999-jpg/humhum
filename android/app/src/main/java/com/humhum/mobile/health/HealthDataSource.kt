package com.humhum.mobile.health

import java.time.LocalDate

interface HealthDataSource {
    val source: HealthSource

    suspend fun readDay(
        day: LocalDate,
        metrics: Set<HealthMetric>,
    ): HealthSummary
}

fun interface HealthPlanProvider {
    suspend fun plan(trigger: SyncTrigger): HealthSourcePlan
}

interface HealthSignalSink {
    fun enqueue(signals: Collection<HealthSignal>, now: java.time.Instant)

    fun sync(): HealthDelivery = HealthDelivery()
}

data class HealthDelivery(
    val result: SyncResult? = null,
    val transientFailure: Boolean = false,
)
