package com.humhum.mobile.health

import androidx.work.BackoffPolicy
import androidx.work.NetworkType
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthWorkContractTest {
    @Test
    fun periodicWorkUsesThePrivateSixHourNetworkContract() {
        val request = WorkManagerHealthBackgroundScheduler.workRequest()

        assertEquals(
            TimeUnit.HOURS.toMillis(6),
            request.workSpec.intervalDuration,
        )
        assertEquals(
            NetworkType.CONNECTED,
            request.workSpec.constraints.requiredNetworkType,
        )
        assertEquals(BackoffPolicy.EXPONENTIAL, request.workSpec.backoffPolicy)
        assertEquals(
            "humhum-health-summary-sync",
            WorkManagerHealthBackgroundScheduler.UNIQUE_WORK_NAME,
        )
    }

    @Test
    fun workerRetriesOnlyTransientTransportFailures() {
        assertTrue(
            HealthSyncWorker.shouldRetry(
                HealthDelivery(transientFailure = true),
            ),
        )
        assertFalse(
            HealthSyncWorker.shouldRetry(
                HealthDelivery(transientFailure = false),
            ),
        )
        assertFalse(HealthSyncWorker.shouldRetry(HealthDelivery()))
    }
}
