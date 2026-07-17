package com.humhum.mobile.health

import java.time.Instant

enum class HealthSourceState {
    DISABLED,
    HEALTH_CONNECT,
    PHONE_STEP_COUNTER,
    UNAVAILABLE,
}

data class HealthSummary(
    val steps: Double?,
    val restingHeartRate: Double?,
    val sleepMinutes: Double?,
    val capturedAt: Instant?,
    val sourceStates: Map<HealthMetric, HealthSourceState>,
)
