package com.humhum.mobile.health

import android.content.pm.PackageManager
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthRepositoryTest {
    private val day = LocalDate.of(2026, 7, 17)
    private val now = Instant.parse("2026-07-17T12:00:00Z")

    @Test
    fun healthConnectWinsAndDeniedMetricsAreNeverRead() = runBlocking {
        val healthConnect = RecordingDataSource(
            HealthSource.HEALTH_CONNECT,
            summary(steps = 6_342.0, capturedAt = now),
        )
        val phone = RecordingDataSource(
            HealthSource.PHONE_STEP_COUNTER,
            summary(steps = 99.0, capturedAt = now),
        )
        val repository = repository(
            plan = HealthSourcePlan(
                foregroundMetrics = setOf(HealthMetric.STEPS),
                backgroundMetrics = emptySet(),
                sourceStates = mapOf(
                    HealthMetric.STEPS to HealthSourceState.HEALTH_CONNECT,
                    HealthMetric.RESTING_HEART_RATE to HealthSourceState.DISABLED,
                    HealthMetric.SLEEP to HealthSourceState.DISABLED,
                ),
            ),
            healthConnect = healthConnect,
            phone = phone,
        )

        val state = repository.refresh(SyncTrigger.FOREGROUND)

        assertEquals(6_342.0, state.summary.steps)
        assertEquals(setOf(HealthMetric.STEPS), healthConnect.requests.single().metrics)
        assertTrue(phone.requests.isEmpty())
        assertNull(state.summary.restingHeartRate)
        assertNull(state.summary.sleepMinutes)
    }

    @Test
    fun phoneCounterIsUsedOnlyForStepsWhenHealthConnectIsUnavailable() = runBlocking {
        val phone = RecordingDataSource(
            HealthSource.PHONE_STEP_COUNTER,
            summary(steps = 420.0, capturedAt = now),
        )
        val plan = HealthSourcePolicy.plan(
            healthConnectAvailable = false,
            stepSensorAvailable = true,
            grants = setOf(HealthMetric.STEPS, HealthMetric.RESTING_HEART_RATE, HealthMetric.SLEEP),
            backgroundGranted = false,
        )

        val state = repository(plan = plan, phone = phone).refresh(SyncTrigger.FOREGROUND)

        assertEquals(420.0, state.summary.steps)
        assertEquals(setOf(HealthMetric.STEPS), phone.requests.single().metrics)
        assertNull(state.summary.restingHeartRate)
        assertNull(state.summary.sleepMinutes)
        assertEquals(
            HealthSourceState.UNAVAILABLE,
            state.summary.sourceStates[HealthMetric.RESTING_HEART_RATE],
        )
    }

    @Test
    fun oneUnavailableMetricDoesNotHideTheUsableDailySummary() = runBlocking {
        val healthConnect = RecordingDataSource(
            HealthSource.HEALTH_CONNECT,
            summary(
                steps = 3_000.0,
                restingHeartRate = null,
                sleepMinutes = 451.0,
                capturedAt = now,
            ),
        )
        val state = repository(
            plan = allHealthConnectPlan(backgroundGranted = false),
            healthConnect = healthConnect,
        ).refresh(SyncTrigger.FOREGROUND)

        assertEquals(3_000.0, state.summary.steps)
        assertNull(state.summary.restingHeartRate)
        assertEquals(451.0, state.summary.sleepMinutes)
        assertEquals(HealthFreshness.FRESH, state.freshness)
        assertEquals(2, state.enqueuedSignals)
    }

    @Test
    fun staleCaptureIsLabeledWithoutDiscardingValues() = runBlocking {
        val capturedAt = now.minusSeconds(6 * 60 * 60 + 1)
        val state = repository(
            plan = allHealthConnectPlan(backgroundGranted = false),
            healthConnect = RecordingDataSource(
                HealthSource.HEALTH_CONNECT,
                summary(steps = 1_234.0, capturedAt = capturedAt),
            ),
        ).refresh(SyncTrigger.FOREGROUND)

        assertEquals(1_234.0, state.summary.steps)
        assertEquals(HealthFreshness.STALE, state.freshness)
    }

    @Test
    fun sourceFailureReturnsAnEmptyStateInsteadOfInventingData() = runBlocking {
        val state = repository(
            plan = allHealthConnectPlan(backgroundGranted = false),
            healthConnect = RecordingDataSource(
                HealthSource.HEALTH_CONNECT,
                IOException("provider unavailable"),
            ),
        ).refresh(SyncTrigger.FOREGROUND)

        assertEquals(HealthFreshness.EMPTY, state.freshness)
        assertTrue(state.summary.steps == null && state.summary.sleepMinutes == null)
        assertTrue(state.notices.any { it.contains("provider unavailable") })
    }

    @Test
    fun transientQueueWriteFailureIsReportedForWorkerRetry() = runBlocking {
        val sink = object : HealthSignalSink {
            override fun enqueue(signals: Collection<HealthSignal>, now: Instant) {
                throw HealthQueueUnavailableException(
                    "queue unavailable",
                    IOException("disk busy"),
                )
            }
        }
        val repository = HealthRepository(
            planProvider = { allHealthConnectPlan(backgroundGranted = true) },
            healthConnectSource = RecordingDataSource(
                HealthSource.HEALTH_CONNECT,
                summary(steps = 1_234.0, capturedAt = now),
            ),
            phoneStepSource = null,
            signalSink = sink,
            dayProvider = { day },
            clock = { now },
            zone = ZoneOffset.UTC,
        )

        val state = repository.refresh(SyncTrigger.BACKGROUND)

        assertTrue(state.delivery.queueUnavailable)
        assertTrue(state.delivery.transientFailure)
        assertEquals(0, state.enqueuedSignals)
    }

    @Test
    fun backgroundSyncUsesOnlyTheSeparatelyGrantedMetricSet() = runBlocking {
        val healthConnect = RecordingDataSource(
            HealthSource.HEALTH_CONNECT,
            summary(steps = 555.0, restingHeartRate = 61.0, capturedAt = now),
        )
        val plan = HealthSourcePlan(
            foregroundMetrics = setOf(HealthMetric.STEPS, HealthMetric.RESTING_HEART_RATE),
            backgroundMetrics = setOf(HealthMetric.STEPS),
            sourceStates = mapOf(
                HealthMetric.STEPS to HealthSourceState.HEALTH_CONNECT,
                HealthMetric.RESTING_HEART_RATE to HealthSourceState.HEALTH_CONNECT,
                HealthMetric.SLEEP to HealthSourceState.DISABLED,
            ),
        )

        repository(plan = plan, healthConnect = healthConnect)
            .refresh(SyncTrigger.BACKGROUND)

        assertEquals(setOf(HealthMetric.STEPS), healthConnect.requests.single().metrics)
    }

    @Test
    fun noGrantedMetricDoesNotReadOrFlushAnOlderQueue() = runBlocking {
        val sink = RecordingSignalSink()
        val repository = HealthRepository(
            planProvider = {
                HealthSourcePolicy.plan(
                    healthConnectAvailable = true,
                    stepSensorAvailable = true,
                    grants = emptySet(),
                    backgroundGranted = false,
                )
            },
            healthConnectSource = RecordingDataSource(
                HealthSource.HEALTH_CONNECT,
                summary(steps = 1.0, capturedAt = now),
            ),
            phoneStepSource = null,
            signalSink = sink,
            dayProvider = { day },
            clock = { now },
            zone = ZoneOffset.UTC,
        )

        val state = repository.refresh(SyncTrigger.FOREGROUND)

        assertEquals(HealthFreshness.EMPTY, state.freshness)
        assertEquals(0, sink.syncCalls)
    }

    @Test
    fun backgroundWorkRequiresFeatureAndSeparatePermission() = runBlocking {
        val scheduler = RecordingScheduler()
        val snapshots = ArrayDeque(
            listOf(
                permissionSnapshot(backgroundFeatureAvailable = true, backgroundGranted = false),
                permissionSnapshot(backgroundFeatureAvailable = false, backgroundGranted = true),
                permissionSnapshot(backgroundFeatureAvailable = true, backgroundGranted = true),
            ),
        )
        val controller = HealthPermissionController(
            snapshotProvider = { snapshots.removeFirst() },
            scheduler = scheduler,
        )

        controller.reconcileBackgroundSync()
        controller.reconcileBackgroundSync()
        controller.reconcileBackgroundSync()

        assertEquals(listOf("cancel", "cancel", "schedule"), scheduler.actions)
    }

    @Test
    fun backgroundPermissionWithoutAnyMetricGrantDoesNotScheduleWork() = runBlocking {
        val scheduler = RecordingScheduler()
        val controller = HealthPermissionController(
            snapshotProvider = {
                HealthPermissionSnapshot(
                    healthConnectAvailable = true,
                    backgroundFeatureAvailable = true,
                    stepSensorAvailable = true,
                    activityRecognitionGranted = true,
                    grantedHealthPermissions =
                        HealthPermissionController.backgroundPermissions(),
                )
            },
            scheduler = scheduler,
        )

        controller.reconcileBackgroundSync()

        assertEquals(listOf("cancel"), scheduler.actions)
    }

    @Test
    fun healthPermissionRequestsAreReadOnlyAndMetricSpecific() {
        val steps = HealthPermissionController.permissionsFor(HealthMetric.STEPS)
        val heart = HealthPermissionController.permissionsFor(HealthMetric.RESTING_HEART_RATE)
        val sleep = HealthPermissionController.permissionsFor(HealthMetric.SLEEP)

        assertEquals(setOf("android.permission.health.READ_STEPS"), steps)
        assertEquals(setOf("android.permission.health.READ_RESTING_HEART_RATE"), heart)
        assertEquals(setOf("android.permission.health.READ_SLEEP"), sleep)
        assertTrue(
            HealthPermissionController.backgroundPermissions()
                .contains("android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"),
        )
        assertFalse(
            (steps + heart + sleep + HealthPermissionController.backgroundPermissions())
                .any { it.contains("WRITE_") },
        )
    }

    @Test
    fun legacyAndroidDoesNotRequireTheRuntimeActivityRecognitionGrant() {
        assertTrue(
            HealthPermissionController.hasActivityRecognitionAccess(
                sdkInt = 28,
                permissionResult = PackageManager.PERMISSION_DENIED,
            ),
        )
        assertFalse(
            HealthPermissionController.hasActivityRecognitionAccess(
                sdkInt = 29,
                permissionResult = PackageManager.PERMISSION_DENIED,
            ),
        )
        assertTrue(
            HealthPermissionController.hasActivityRecognitionAccess(
                sdkInt = 36,
                permissionResult = PackageManager.PERMISSION_GRANTED,
            ),
        )
    }

    private fun repository(
        plan: HealthSourcePlan,
        healthConnect: HealthDataSource? = null,
        phone: HealthDataSource? = null,
    ): HealthRepository = HealthRepository(
        planProvider = { plan },
        healthConnectSource = healthConnect,
        phoneStepSource = phone,
        signalSink = RecordingSignalSink(),
        dayProvider = { day },
        clock = { now },
        zone = ZoneOffset.UTC,
    )

    private fun summary(
        steps: Double? = null,
        restingHeartRate: Double? = null,
        sleepMinutes: Double? = null,
        capturedAt: Instant?,
    ) = HealthSummary(
        steps = steps,
        restingHeartRate = restingHeartRate,
        sleepMinutes = sleepMinutes,
        capturedAt = capturedAt,
        sourceStates = HealthMetric.entries.associateWith {
            if (valueFor(it, steps, restingHeartRate, sleepMinutes) == null) {
                HealthSourceState.UNAVAILABLE
            } else {
                HealthSourceState.HEALTH_CONNECT
            }
        },
    )

    private fun valueFor(
        metric: HealthMetric,
        steps: Double?,
        heart: Double?,
        sleep: Double?,
    ): Double? = when (metric) {
        HealthMetric.STEPS -> steps
        HealthMetric.RESTING_HEART_RATE -> heart
        HealthMetric.SLEEP -> sleep
    }

    private fun allHealthConnectPlan(backgroundGranted: Boolean) = HealthSourcePolicy.plan(
        healthConnectAvailable = true,
        stepSensorAvailable = true,
        grants = HealthMetric.entries.toSet(),
        backgroundGranted = backgroundGranted,
    )

    private fun permissionSnapshot(
        backgroundFeatureAvailable: Boolean,
        backgroundGranted: Boolean,
    ) = HealthPermissionSnapshot(
        healthConnectAvailable = true,
        backgroundFeatureAvailable = backgroundFeatureAvailable,
        stepSensorAvailable = true,
        activityRecognitionGranted = true,
        grantedHealthPermissions = HealthMetric.entries
            .flatMap(HealthPermissionController::permissionsFor)
            .toSet() + if (backgroundGranted) {
            HealthPermissionController.backgroundPermissions()
        } else {
            emptySet()
        },
    )

    private class RecordingDataSource(
        override val source: HealthSource,
        private val answer: Any,
    ) : HealthDataSource {
        val requests = mutableListOf<HealthReadRequest>()

        override suspend fun readDay(
            day: LocalDate,
            metrics: Set<HealthMetric>,
        ): HealthSummary {
            requests += HealthReadRequest(day, metrics)
            if (answer is Exception) throw answer
            return answer as HealthSummary
        }
    }

    private class RecordingSignalSink : HealthSignalSink {
        var syncCalls = 0
        override fun enqueue(signals: Collection<HealthSignal>, now: Instant) = Unit

        override fun sync(): HealthDelivery {
            syncCalls += 1
            return HealthDelivery()
        }
    }

    private class RecordingScheduler : HealthBackgroundScheduler {
        val actions = mutableListOf<String>()
        override fun schedule() {
            actions += "schedule"
        }

        override fun cancel() {
            actions += "cancel"
        }
    }

    private data class HealthReadRequest(
        val day: LocalDate,
        val metrics: Set<HealthMetric>,
    )
}
