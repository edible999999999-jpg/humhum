package com.humhum.mobile.health

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.time.DateTimeException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONException

class PhoneStepCheckpointUnavailableException(message: String, cause: Throwable) :
    IllegalStateException(message, cause)

class EncryptedStepCheckpointStore(context: Context) : PhoneStepCheckpointStore {
    private val file = AtomicFile(File(context.noBackupFilesDir, FILE_NAME))

    @Synchronized
    override fun read(): PhoneStepCheckpoint? {
        return try {
            val envelope = file.openRead().use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(512)
                var total = 0
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    total += count
                    if (total > MAX_ENVELOPE_BYTES) throw IOException("Step checkpoint is too large")
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            PhoneStepCheckpointCodec.decode(decrypt(envelope))
        } catch (_: FileNotFoundException) {
            null
        } catch (_: GeneralSecurityException) {
            file.delete()
            null
        } catch (_: JSONException) {
            file.delete()
            null
        } catch (_: DateTimeException) {
            file.delete()
            null
        } catch (_: IllegalArgumentException) {
            file.delete()
            null
        } catch (error: IOException) {
            throw PhoneStepCheckpointUnavailableException(
                "Phone step checkpoint is temporarily unavailable",
                error,
            )
        }
    }

    @Synchronized
    override fun write(checkpoint: PhoneStepCheckpoint) {
        val encrypted = try {
            encrypt(PhoneStepCheckpointCodec.encode(checkpoint))
        } catch (error: GeneralSecurityException) {
            throw PhoneStepCheckpointUnavailableException(
                "Could not encrypt phone step checkpoint",
                error,
            )
        }
        var output = try {
            file.startWrite()
        } catch (error: IOException) {
            throw PhoneStepCheckpointUnavailableException(
                "Could not open phone step checkpoint",
                error,
            )
        }
        try {
            output.write(encrypted)
            file.finishWrite(output)
        } catch (error: IOException) {
            file.failWrite(output)
            throw PhoneStepCheckpointUnavailableException(
                "Could not persist phone step checkpoint",
                error,
            )
        }
    }

    @Throws(GeneralSecurityException::class)
    private fun encrypt(plaintext: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        cipher.updateAAD(ASSOCIATED_DATA)
        val nonce = cipher.iv
        require(nonce.size == NONCE_BYTES) { "Phone step checkpoint nonce is invalid" }
        return byteArrayOf(FORMAT_VERSION) + nonce + cipher.doFinal(plaintext)
    }

    @Throws(GeneralSecurityException::class)
    private fun decrypt(envelope: ByteArray): ByteArray {
        require(envelope.size > 1 + NONCE_BYTES) { "Phone step checkpoint is invalid" }
        require(envelope[0] == FORMAT_VERSION) { "Phone step checkpoint version is invalid" }
        val nonce = envelope.copyOfRange(1, 1 + NONCE_BYTES)
        val ciphertext = envelope.copyOfRange(1 + NONCE_BYTES, envelope.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, nonce))
        cipher.updateAAD(ASSOCIATED_DATA)
        return cipher.doFinal(ciphertext)
    }

    @Throws(GeneralSecurityException::class)
    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        val existing = keyStore.getKey(KEY_ALIAS, null)
        if (existing is SecretKey) return existing
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
            generateKey()
        }
    }

    companion object {
        private const val FILE_NAME = "humhum-phone-step-checkpoint-v1.bin"
        private const val KEY_ALIAS = "humhum_phone_step_checkpoint_v1"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val NONCE_BYTES = 12
        private const val TAG_BITS = 128
        private const val MAX_ENVELOPE_BYTES = 4_096
        private val FORMAT_VERSION: Byte = 1
        private val ASSOCIATED_DATA = "HUMHUM_PHONE_STEP_CHECKPOINT_V1".toByteArray(Charsets.UTF_8)
    }
}
