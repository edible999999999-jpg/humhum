package com.humhum.mobile.health

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class HealthForegroundRefreshTest {
    @Test
    fun repeatedResumeSignalsCoalesceIntoOneInFlightRefresh() = runTest {
        val release = CompletableDeferred<Unit>()
        var calls = 0
        val coordinator = HealthForegroundCoordinator(this) {
            calls += 1
            release.await()
        }

        coordinator.request()
        coordinator.request()
        coordinator.request()
        runCurrent()

        assertEquals(1, calls)
        release.complete(Unit)
        advanceUntilIdle()
    }

    @Test
    fun refreshFailureIsContainedAndTheNextResumeCanRun() = runTest {
        var calls = 0
        val coordinator = HealthForegroundCoordinator(this) {
            calls += 1
            if (calls == 1) throw IOException("Health provider unavailable")
        }

        coordinator.request()
        advanceUntilIdle()
        coordinator.request()
        advanceUntilIdle()

        assertEquals(2, calls)
    }
}
