package com.humhum.mobile.health

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EncryptedHealthQueueDeviceTest {
    @Test
    fun ciphertextSurvivesQueueRecreationAndDoesNotContainHealthValue() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val queue = EncryptedHealthQueue(context)
        queue.clear()
        val signal = HealthSignal.forLocalDay(
            metric = HealthMetric.STEPS,
            value = 6_342.0,
            source = HealthSource.HEALTH_CONNECT,
            day = LocalDate.of(2026, 7, 17),
            zone = ZoneOffset.UTC,
            capturedAt = Instant.parse("2026-07-17T13:00:00Z"),
        )

        queue.enqueue(listOf(signal), Instant.parse("2026-07-17T13:00:00Z"))

        val encryptedFile = File(context.noBackupFilesDir, EncryptedHealthQueue.FILE_NAME)
        assertTrue(encryptedFile.isFile)
        assertFalse(encryptedFile.readBytes().toString(Charsets.ISO_8859_1).contains("6342"))

        val restored = EncryptedHealthQueue(context).peekBatch(31)
        assertEquals(listOf(signal), restored)
    }

    @Test
    fun queuePrunesSignalsOlderThanSevenDaysAndLimitsBatches() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val queue = EncryptedHealthQueue(context)
        queue.clear()
        val now = Instant.parse("2026-07-17T13:00:00Z")
        val old = HealthSignal.forLocalDay(
            HealthMetric.STEPS, 9.0, HealthSource.HEALTH_CONNECT,
            LocalDate.of(2026, 7, 9), ZoneOffset.UTC, now,
        )
        val current = (1..32).map { index ->
            HealthSignal.forLocalDay(
                HealthMetric.STEPS,
                index.toDouble(),
                HealthSource.HEALTH_CONNECT,
                LocalDate.of(2026, 7, 10).plusDays(index.toLong()),
                ZoneOffset.UTC,
                now,
            )
        }

        queue.enqueue(listOf(old) + current, now)

        assertEquals(31, queue.peekBatch(31).size)
        assertEquals(31, queue.peekBatch(500).size)
    }
}
