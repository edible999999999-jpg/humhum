package com.humhum.mobile.health

import java.nio.file.Files
import java.nio.file.Path
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneStepCheckpointContractTest {
    @Test
    fun checkpointUsesNoBackupStorageAndAndroidKeystoreEncryption() {
        val source = String(
            Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/health/EncryptedStepCheckpointStore.kt"),
            ),
        )

        assertTrue(source.contains("noBackupFilesDir"))
        assertTrue(source.contains("AndroidKeyStore"))
        assertTrue(source.contains("AES/GCM/NoPadding"))
        assertFalse(source.contains("SharedPreferences"))
    }

    @Test
    fun phoneStepSourceNeverPersistsReadableHealthCountsInPreferences() {
        val source = String(
            Files.readAllBytes(
                Path.of("src/main/java/com/humhum/mobile/health/PhoneStepDataSource.kt"),
            ),
        )

        assertFalse(source.contains("SharedPreferences"))
        assertFalse(source.contains("getSharedPreferences"))
        assertTrue(source.contains("EncryptedStepCheckpointStore"))
    }
}
