package com.humhum.mobile.health

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException

class HealthSyncWorker(
    applicationContext: Context,
    workerParameters: WorkerParameters,
) : CoroutineWorker(applicationContext, workerParameters) {
    override suspend fun doWork(): Result {
        val state = try {
            HealthRuntime.refresh(applicationContext, SyncTrigger.BACKGROUND)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            return Result.success()
        }
        return if (shouldRetry(state.delivery)) Result.retry() else Result.success()
    }

    companion object {
        internal fun shouldRetry(delivery: HealthDelivery): Boolean =
            delivery.transientFailure
    }
}
