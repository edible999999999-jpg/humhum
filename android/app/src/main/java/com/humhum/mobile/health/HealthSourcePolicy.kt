package com.humhum.mobile.health

data class HealthSourcePlan(
    val foregroundMetrics: Set<HealthMetric>,
    val backgroundMetrics: Set<HealthMetric>,
    val sourceStates: Map<HealthMetric, HealthSourceState>,
) {
    fun sourceFor(metric: HealthMetric): HealthSource? = when (sourceStates[metric]) {
        HealthSourceState.HEALTH_CONNECT -> HealthSource.HEALTH_CONNECT
        HealthSourceState.PHONE_STEP_COUNTER -> HealthSource.PHONE_STEP_COUNTER
        else -> null
    }
}

object HealthSourcePolicy {
    fun plan(
        healthConnectAvailable: Boolean,
        stepSensorAvailable: Boolean,
        grants: Set<HealthMetric>,
        backgroundGranted: Boolean,
    ): HealthSourcePlan {
        val states = HealthMetric.entries.associateWith { metric ->
            when {
                metric !in grants -> HealthSourceState.DISABLED
                healthConnectAvailable -> HealthSourceState.HEALTH_CONNECT
                metric == HealthMetric.STEPS && stepSensorAvailable -> {
                    HealthSourceState.PHONE_STEP_COUNTER
                }
                else -> HealthSourceState.UNAVAILABLE
            }
        }
        val foreground = states.filterValues {
            it == HealthSourceState.HEALTH_CONNECT || it == HealthSourceState.PHONE_STEP_COUNTER
        }.keys
        val background = if (backgroundGranted && healthConnectAvailable) {
            states.filterValues { it == HealthSourceState.HEALTH_CONNECT }.keys
        } else {
            emptySet()
        }
        return HealthSourcePlan(foreground, background, states)
    }
}
