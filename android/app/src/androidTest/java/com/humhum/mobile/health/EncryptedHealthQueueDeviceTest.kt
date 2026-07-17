package com.humhum.mobile.health

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.time.Duration
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

        assertEquals(31, queue.peekBatch(31, now).size)
        assertEquals(31, queue.peekBatch(500, now).size)
    }

    @Test
    fun peekPrunesExpiredSignalsWithoutAnotherEnqueue() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val queue = EncryptedHealthQueue(context)
        queue.clear()
        val recordedAt = Instant.parse("2026-07-17T13:00:00Z")
        val signal = HealthSignal.forLocalDay(
            HealthMetric.STEPS,
            7.0,
            HealthSource.HEALTH_CONNECT,
            LocalDate.of(2026, 7, 17),
            ZoneOffset.UTC,
            recordedAt,
        )
        queue.enqueue(listOf(signal), recordedAt)

        assertEquals(1, queue.peekBatch(31, recordedAt.plus(Duration.ofDays(1))).size)
        var uploadCalls = 0
        val sync = HealthSignalUploader().syncPending(
            HealthSignalConnection(direct = HealthSignalTransport { _ ->
                uploadCalls += 1
                UploadResponse(imported = 1, duplicates = 0)
            }),
            queue,
            recordedAt.plus(Duration.ofDays(9)),
        )

        assertTrue(sync.delivered)
        assertEquals(0, uploadCalls)
        assertTrue(queue.peekBatch(31, recordedAt.plus(Duration.ofDays(9))).isEmpty())
    }

    @Test
    fun transientReadFailureDoesNotDiscardTheQueue() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val queue = EncryptedHealthQueue(context, UnavailableQueueFile())
        try {
            queue.peekBatch(31, Instant.parse("2026-07-17T13:00:00Z"))
            throw AssertionError("Expected recoverable queue read failure")
        } catch (_: HealthQueueUnavailableException) {
            // Expected.
        }
        val signal = HealthSignal.forLocalDay(
            HealthMetric.STEPS,
            2.0,
            HealthSource.HEALTH_CONNECT,
            LocalDate.of(2026, 7, 17),
            ZoneOffset.UTC,
            Instant.parse("2026-07-17T13:00:00Z"),
        )
        try {
            queue.enqueue(listOf(signal), Instant.parse("2026-07-17T13:00:00Z"))
            throw AssertionError("Expected recoverable queue read failure")
        } catch (_: HealthQueueUnavailableException) {
            // Expected.
        }
    }

    @Test
    fun corruptedPrimaryFileIsQuarantinedInsteadOfDeletingAtomicBackup() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val queue = EncryptedHealthQueue(context)
        queue.clear()
        val primary = File(context.noBackupFilesDir, EncryptedHealthQueue.FILE_NAME)
        primary.writeBytes(byteArrayOf(0, 1, 2, 3))

        assertTrue(queue.peekBatch(31, Instant.parse("2026-07-17T13:00:00Z")).isEmpty())
        assertFalse(primary.exists())
        assertTrue(primary.parentFile!!.listFiles().orEmpty().any {
            it.name.startsWith("${EncryptedHealthQueue.FILE_NAME}.corrupt-")
        })
    }

    private class UnavailableQueueFile : HealthQueueFile {
        override fun openRead(): InputStream = throw IOException("temporary storage outage")
        override fun startWrite(): FileOutputStream = throw IOException("not used")
        override fun finishWrite(output: FileOutputStream) = Unit
        override fun failWrite(output: FileOutputStream) = Unit
        override fun delete() = Unit
        override fun quarantinePrimary(): Boolean = false
    }
}
