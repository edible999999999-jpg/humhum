package com.humhum.mobile;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

public final class EncryptedPersonalContextStore {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "humhum-personal-context-v1";
    private static final String FILE_NAME = "humhum-personal-context-v1.json";
    private static final int MAX_ENVELOPE_BYTES = 256 * 1024;

    private final AtomicFile contextFile;

    public EncryptedPersonalContextStore(Context context) {
        if (context == null) throw new IllegalArgumentException("Context is missing");
        contextFile = new AtomicFile(new File(context.getNoBackupFilesDir(), FILE_NAME));
    }

    public void write(
            ConnectionStore.Connection connection,
            Models.PersonalContext context,
            long savedAtMillis) {
        try {
            byte[] envelope = SessionSnapshotCipher.encrypt(
                    PersonalContextCodec.encode(context),
                    binding(connection),
                    keyForWrite(),
                    savedAtMillis);
            writeAtomically(envelope);
        } catch (Exception error) {
            clear();
        }
    }

    public PersonalContextSnapshot read(
            ConnectionStore.Connection connection, long nowMillis) {
        try (InputStream input = contextFile.openRead()) {
            byte[] envelope = readBounded(input);
            SessionSnapshotCipher.Decrypted decrypted = SessionSnapshotCipher.decrypt(
                    envelope, binding(connection), existingKey(), nowMillis);
            if (!PersonalContextSnapshot.isFresh(decrypted.savedAtMillis(), nowMillis)) {
                throw new GeneralSecurityException("Personal context snapshot expired");
            }
            return new PersonalContextSnapshot(
                    decrypted.savedAtMillis(),
                    PersonalContextCodec.decode(decrypted.payload()));
        } catch (FileNotFoundException error) {
            return null;
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    public void clear() {
        contextFile.delete();
        try {
            KeyStore store = keyStore();
            if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
        }
    }

    static String binding(ConnectionStore.Connection connection) {
        return EncryptedSessionSnapshotStore.binding(connection) + ":personal-context-v1";
    }

    private void writeAtomically(byte[] envelope) throws IOException {
        if (envelope.length > MAX_ENVELOPE_BYTES) {
            throw new IOException("Personal context envelope is too large");
        }
        FileOutputStream output = null;
        try {
            output = contextFile.startWrite();
            output.write(envelope);
            contextFile.finishWrite(output);
        } catch (IOException error) {
            if (output != null) contextFile.failWrite(output);
            throw error;
        }
    }

    private SecretKey keyForWrite() throws GeneralSecurityException, IOException {
        KeyStore store = keyStore();
        Key existing = store.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        if (existing != null) store.deleteEntry(KEY_ALIAS);
        KeyGenerator generator =
                KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private SecretKey existingKey() throws GeneralSecurityException, IOException {
        Key key = keyStore().getKey(KEY_ALIAS, null);
        if (!(key instanceof SecretKey)) {
            throw new GeneralSecurityException("Personal context key is missing");
        }
        return (SecretKey) key;
    }

    private KeyStore keyStore() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance(KEYSTORE_PROVIDER);
        store.load(null);
        return store;
    }

    private static byte[] readBounded(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8 * 1024];
        int size = 0;
        while (true) {
            int remaining = MAX_ENVELOPE_BYTES - size;
            int count = input.read(buffer, 0, Math.min(buffer.length, remaining + 1));
            if (count == -1) return output.toByteArray();
            if (count == 0) continue;
            if (count > remaining) {
                throw new IOException("Personal context envelope is too large");
            }
            output.write(buffer, 0, count);
            size += count;
        }
    }
}
