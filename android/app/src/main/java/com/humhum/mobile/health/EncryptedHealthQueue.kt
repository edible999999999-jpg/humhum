package com.humhum.mobile.health

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.charset.StandardCharsets
import java.security.GeneralSecurityException
import java.security.Key
import java.security.KeyStore
import java.time.Duration
import java.time.Instant
import java.time.DateTimeException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONException

class HealthQueueUnavailableException(message: String, cause: Throwable) :
    IllegalStateException(message, cause)

interface HealthQueueFile {
    @Throws(IOException::class)
    fun openRead(): InputStream

    @Throws(IOException::class)
    fun startWrite(): FileOutputStream
    fun finishWrite(output: FileOutputStream)
    fun failWrite(output: FileOutputStream)
    fun delete()
    fun quarantinePrimary(): Boolean
}

class EncryptedHealthQueue private constructor(private val queueFile: HealthQueueFile) : PendingHealthSignalQueue {
    constructor(context: Context) : this(
        AtomicHealthQueueFile(File(requireNotNull(context).noBackupFilesDir, FILE_NAME)),
    )

    internal constructor(context: Context, queueFile: HealthQueueFile) : this(queueFile) {
        requireNotNull(context) { "Context is missing" }
    }

    @Synchronized
    fun enqueue(signals: Collection<HealthSignal>, now: Instant = Instant.now()) {
        if (signals.isEmpty()) return
        val merged = LinkedHashMap<String, HealthSignal>()
        readSignals().forEach { merged[it.sourceId] = it }
        signals.forEach { merged[it.sourceId] = it }
        writeSignals(retainCurrent(merged.values, now).takeLast(MAX_QUEUE_RECORDS))
    }

    @Synchronized
    override fun peekBatch(limit: Int, now: Instant): List<HealthSignal> {
        require(limit > 0) { "Health signal batch limit must be positive" }
        val stored = readSignals()
        val retained = retainCurrent(stored, now)
        if (retained.size != stored.size) writeSignals(retained)
        return retained.take(limit.coerceAtMost(MAX_HEALTH_SIGNAL_BATCH_SIZE))
    }

    override fun peekBatch(limit: Int): List<HealthSignal> =
        peekBatch(limit, Instant.now())

    @Synchronized
    override fun acknowledge(sourceIds: Collection<String>) {
        if (sourceIds.isEmpty()) return
        val acknowledged = sourceIds.toSet()
        writeSignals(readSignals().filterNot { it.sourceId in acknowledged })
    }

    @Synchronized
    fun pruneExpired(now: Instant = Instant.now()) {
        writeSignals(retainCurrent(readSignals(), now))
    }

    @Synchronized
    fun clear() {
        queueFile.delete()
        try {
            val keyStore = keyStore()
            if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
        } catch (_: Exception) {
            // The unreadable queue file has already been removed.
        }
    }

    private fun readSignals(): List<HealthSignal> {
        try {
            queueFile.openRead().use { input ->
                val plaintext = decrypt(readBounded(input))
                val values = JSONArray(String(plaintext, StandardCharsets.UTF_8))
                return buildList {
                    for (index in 0 until values.length()) {
                        add(HealthSignal.fromJson(values.getJSONObject(index)))
                    }
                }
            }
        } catch (_: FileNotFoundException) {
            return emptyList()
        } catch (error: HealthQueueCorruptionException) {
            return discardCorruptPrimary(error)
        } catch (error: GeneralSecurityException) {
            return discardCorruptPrimary(error)
        } catch (error: JSONException) {
            return discardCorruptPrimary(error)
        } catch (error: DateTimeException) {
            return discardCorruptPrimary(error)
        } catch (error: IllegalArgumentException) {
            return discardCorruptPrimary(error)
        } catch (error: IOException) {
            throw HealthQueueUnavailableException("Health queue is temporarily unavailable", error)
        }
    }

    private fun discardCorruptPrimary(cause: Exception): List<HealthSignal> {
        if (!queueFile.quarantinePrimary()) {
            throw HealthQueueUnavailableException("Could not quarantine corrupt health queue", cause)
        }
        return emptyList()
    }

    private fun retainCurrent(signals: Collection<HealthSignal>, now: Instant): List<HealthSignal> {
        val cutoff = now.minus(MAX_QUEUE_AGE)
        return signals
            .filter { !it.endedAt.isBefore(cutoff) }
            .sortedWith(compareBy<HealthSignal> { it.startedAt }.thenBy { it.sourceId })
    }

    private fun writeSignals(signals: Collection<HealthSignal>) {
        if (signals.isEmpty()) {
            queueFile.delete()
            return
        }
        val data = JSONArray().also { array -> signals.forEach { array.put(it.toJson()) } }
            .toString()
            .toByteArray(StandardCharsets.UTF_8)
        val encrypted = encrypt(data)
        var output: FileOutputStream? = null
        try {
            output = queueFile.startWrite()
            output.write(encrypted)
            queueFile.finishWrite(output)
        } catch (error: IOException) {
            output?.let(queueFile::failWrite)
            throw HealthQueueUnavailableException("Could not persist health queue", error)
        }
    }

    private fun encrypt(plaintext: ByteArray): ByteArray {
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, keyForWrite())
            cipher.updateAAD(ASSOCIATED_DATA)
            val nonce = cipher.iv
            require(nonce.size == GCM_NONCE_BYTES) { "Health queue nonce is invalid" }
            return byteArrayOf(FORMAT_VERSION) + nonce + cipher.doFinal(plaintext)
        } catch (error: GeneralSecurityException) {
            throw IllegalStateException("Could not encrypt health queue", error)
        }
    }

    private fun decrypt(envelope: ByteArray): ByteArray {
        if (envelope.size <= 1 + GCM_NONCE_BYTES || envelope[0] != FORMAT_VERSION) {
            throw GeneralSecurityException("Health queue envelope is invalid")
        }
        val nonce = envelope.copyOfRange(1, 1 + GCM_NONCE_BYTES)
        val ciphertext = envelope.copyOfRange(1 + GCM_NONCE_BYTES, envelope.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, existingKey(), GCMParameterSpec(GCM_TAG_BITS, nonce))
        cipher.updateAAD(ASSOCIATED_DATA)
        return cipher.doFinal(ciphertext)
    }

    private fun keyForWrite(): SecretKey {
        val keyStore = keyStore()
        val existing: Key? = keyStore.getKey(KEY_ALIAS, null)
        if (existing is SecretKey) return existing
        if (existing != null) keyStore.deleteEntry(KEY_ALIAS)
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun existingKey(): SecretKey = keyStore().getKey(KEY_ALIAS, null) as? SecretKey
        ?: throw GeneralSecurityException("Health queue key is missing")

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).also { it.load(null) }

    private fun readBounded(input: InputStream): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var size = 0
        while (true) {
            val remaining = MAX_ENVELOPE_BYTES - size
            val read = input.read(buffer, 0, minOf(buffer.size, remaining + 1))
            if (read == -1) return output.toByteArray()
            if (read == 0) continue
            if (read > remaining) throw HealthQueueCorruptionException("Health queue is too large")
            output.write(buffer, 0, read)
            size += read
        }
    }

    companion object {
        const val FILE_NAME = "humhum-health-outbound-v1.bin"
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "humhum-health-outbound-v1"
        private const val FORMAT_VERSION: Byte = 1
        private const val GCM_NONCE_BYTES = 12
        private const val GCM_TAG_BITS = 128
        private const val MAX_ENVELOPE_BYTES = 256 * 1024
        private const val MAX_QUEUE_RECORDS = MAX_HEALTH_SIGNAL_BATCH_SIZE
        private val MAX_QUEUE_AGE = Duration.ofDays(7)
        private val ASSOCIATED_DATA = "humhum-health-outbound-v1".toByteArray(StandardCharsets.UTF_8)
    }
}

private class HealthQueueCorruptionException(message: String) : IOException(message)

private class AtomicHealthQueueFile(private val primary: File) : HealthQueueFile {
    private val atomic = AtomicFile(primary)

    override fun openRead(): InputStream = atomic.openRead()
    override fun startWrite(): FileOutputStream = atomic.startWrite()
    override fun finishWrite(output: FileOutputStream) = atomic.finishWrite(output)
    override fun failWrite(output: FileOutputStream) = atomic.failWrite(output)
    override fun delete() = atomic.delete()

    override fun quarantinePrimary(): Boolean {
        if (!primary.exists()) return true
        val parent = primary.parentFile ?: return false
        val quarantined = File(parent, "${primary.name}.corrupt-${System.currentTimeMillis()}")
        return primary.renameTo(quarantined)
    }
}
