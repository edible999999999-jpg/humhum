package com.humhum.mobile;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.security.KeyStore;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

@RunWith(AndroidJUnit4.class)
public final class EncryptedSessionSnapshotStoreDeviceTest {
    private static final String KEY_ALIAS = "humhum-session-snapshot-v1";
    private static final String FILE_NAME = "humhum-session-snapshot-v1.json";

    @Test
    public void testAndroidKeystoreRoundTripAndClear() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        EncryptedSessionSnapshotStore store = new EncryptedSessionSnapshotStore(context);
        store.clear();

        ConnectionStore.Connection connection = new ConnectionStore.Connection(
                BridgeConfig.restore(
                        "https://192.168.31.211:31276",
                        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                        "HUMHUM device test"),
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                Models.Scope.CONTROL,
                null);
        long savedAt = System.currentTimeMillis();
        Models.Session session = new Models.Session(
                "must-not-persist",
                "codex",
                "HUMHUM",
                "working",
                "now",
                true,
                true,
                List.of(new Models.Action("approval", "codex", "Edit", "private")));

        store.write(connection, List.of(session), savedAt);

        File file = new File(context.getNoBackupFilesDir(), FILE_NAME);
        assertTrue("encrypted snapshot file must exist", file.isFile());
        assertTrue("Android Keystore alias must exist", keyStore().containsAlias(KEY_ALIAS));
        SessionSnapshot restored = store.read(connection, savedAt + 1_000L);
        assertNotNull("Android Keystore snapshot must decrypt", restored);
        assertEquals(1, restored.sessions().size());
        assertEquals("", restored.sessions().get(0).id());
        assertFalse(restored.sessions().get(0).canMessage());
        assertTrue(restored.sessions().get(0).actions().isEmpty());

        store.clear();

        assertFalse("disconnect clear must remove snapshot file", file.exists());
        assertFalse("disconnect clear must delete Android Keystore alias",
                keyStore().containsAlias(KEY_ALIAS));
    }

    private static KeyStore keyStore() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        return keyStore;
    }
}
