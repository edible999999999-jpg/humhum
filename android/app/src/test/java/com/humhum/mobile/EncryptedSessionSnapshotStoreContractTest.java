package com.humhum.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.Test;

public class EncryptedSessionSnapshotStoreContractTest {
    private static final String SOURCE =
            "src/main/java/com/humhum/mobile/EncryptedSessionSnapshotStore.java";

    @Test
    public void storesSnapshotsWithAndroidKeystoreAndAtomicNoBackupLifecycle() throws Exception {
        String source = new String(Files.readAllBytes(Path.of(SOURCE)), StandardCharsets.UTF_8);
        String cipher = new String(Files.readAllBytes(Path.of(
                "src/main/java/com/humhum/mobile/SessionSnapshotCipher.java")), StandardCharsets.UTF_8);

        assertTrue(source.contains("AndroidKeyStore"));
        assertTrue(source.contains("SessionSnapshotCipher.encrypt("));
        assertTrue(cipher.contains("AES/GCM/NoPadding"));
        assertTrue(source.contains("setKeySize(256)"));
        assertTrue(source.contains("setRandomizedEncryptionRequired(true)"));
        assertTrue(source.contains("getNoBackupFilesDir()"));
        assertTrue(source.contains("AtomicFile"));
        assertTrue(source.contains("SNAPSHOT_KEY_ALIAS = \"humhum-session-snapshot-v1\""));
        assertTrue(source.contains("SNAPSHOT_FILE_NAME = \"humhum-session-snapshot-v1.json\""));

        String clear = source.substring(source.indexOf("public void clear()"));
        assertTrue(clear.contains("snapshotFile.delete()"));
        assertTrue(clear.contains("keyStore.deleteEntry(SNAPSHOT_KEY_ALIAS)"));
    }

    @Test
    public void bindingChangesForUrlFingerprintAndScope() {
        String baseline = EncryptedSessionSnapshotStore.binding(connection(
                "https://192.168.1.4:31276", "A".repeat(64), "Xiaomi Android", "a".repeat(64),
                Models.Scope.READ));

        assertTrue(baseline.matches("[0-9a-f]{64}"));
        assertNotEquals(baseline, EncryptedSessionSnapshotStore.binding(connection(
                "https://192.168.1.5:31276", "A".repeat(64), "Xiaomi Android", "a".repeat(64),
                Models.Scope.READ)));
        assertNotEquals(baseline, EncryptedSessionSnapshotStore.binding(connection(
                "https://192.168.1.4:31276", "B".repeat(64), "Xiaomi Android", "a".repeat(64),
                Models.Scope.READ)));
        assertNotEquals(baseline, EncryptedSessionSnapshotStore.binding(connection(
                "https://192.168.1.4:31276", "A".repeat(64), "Xiaomi Android", "a".repeat(64),
                Models.Scope.CONTROL)));
    }

    @Test
    public void bindingDoesNotIncludeTokenOrDeviceName() {
        String baseline = EncryptedSessionSnapshotStore.binding(connection(
                "https://192.168.1.4:31276", "A".repeat(64), "Xiaomi Android", "a".repeat(64),
                Models.Scope.READ));

        assertEquals(baseline, EncryptedSessionSnapshotStore.binding(connection(
                "https://192.168.1.4:31276", "A".repeat(64), "Kitchen tablet", "b".repeat(64),
                Models.Scope.READ)));
        assertFalse(baseline.contains("a".repeat(64)));
        assertFalse(baseline.contains("Xiaomi Android"));
    }

    private static ConnectionStore.Connection connection(
            String url, String fingerprint, String deviceName, String token, Models.Scope scope) {
        return new ConnectionStore.Connection(
                BridgeConfig.restore(url, fingerprint, deviceName), token, scope, null);
    }
}
