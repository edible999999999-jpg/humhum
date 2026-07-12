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
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.List;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

public final class EncryptedSessionSnapshotStore {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String SNAPSHOT_KEY_ALIAS = "humhum-session-snapshot-v1";
    private static final String SNAPSHOT_FILE_NAME = "humhum-session-snapshot-v1.json";
    private static final int NONCE_BYTES = 12;
    private static final int MAX_ENVELOPE_BYTES = 256 * 1024;

    private final AtomicFile snapshotFile;
    private final SecureRandom secureRandom;

    public EncryptedSessionSnapshotStore(Context context) {
        if (context == null) throw new IllegalArgumentException("Context is missing");
        this.snapshotFile = new AtomicFile(new File(
                context.getNoBackupFilesDir(), SNAPSHOT_FILE_NAME));
        this.secureRandom = new SecureRandom();
    }

    public void write(
            ConnectionStore.Connection connection, List<Models.Session> sessions, long savedAtMillis) {
        try {
            byte[] payload = SessionSnapshotCodec.encode(new SessionSnapshot(savedAtMillis, sessions));
            byte[] nonce = new byte[NONCE_BYTES];
            secureRandom.nextBytes(nonce);
            byte[] envelope = SessionSnapshotCipher.encrypt(
                    payload, binding(connection), keyForWrite(), nonce, savedAtMillis);
            writeAtomically(envelope);
        } catch (Exception error) {
            clear();
        }
    }

    public SessionSnapshot read(ConnectionStore.Connection connection, long nowMillis) {
        try (InputStream input = snapshotFile.openRead()) {
            byte[] envelope = readBounded(input);
            SessionSnapshotCipher.Decrypted decrypted = SessionSnapshotCipher.decrypt(
                    envelope, binding(connection), existingKey(), nowMillis);
            SessionSnapshot snapshot = SessionSnapshotCodec.decode(decrypted.payload());
            if (snapshot.savedAtMillis() != decrypted.savedAtMillis()) {
                throw new GeneralSecurityException("Snapshot timestamps do not match");
            }
            return snapshot;
        } catch (FileNotFoundException error) {
            return null;
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    public void clear() {
        snapshotFile.delete();
        try {
            KeyStore keyStore = keyStore();
            if (keyStore.containsAlias(SNAPSHOT_KEY_ALIAS)) {
                keyStore.deleteEntry(SNAPSHOT_KEY_ALIAS);
            }
        } catch (Exception ignored) {
        }
    }

    static String binding(ConnectionStore.Connection connection) {
        if (connection == null || connection.config() == null || connection.scope() == null) {
            throw new IllegalArgumentException("Connection is missing");
        }
        String source = connection.config().baseUrl()
                + "\n" + connection.config().fingerprint()
                + "\n" + connection.scope().wireValue();
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(source.getBytes(
                    java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder hexadecimal = new StringBuilder(digest.length * 2);
            for (byte value : digest) {
                hexadecimal.append(Character.forDigit((value >>> 4) & 0x0f, 16));
                hexadecimal.append(Character.forDigit(value & 0x0f, 16));
            }
            return hexadecimal.toString();
        } catch (GeneralSecurityException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private void writeAtomically(byte[] envelope) throws IOException {
        if (envelope.length > MAX_ENVELOPE_BYTES) {
            throw new IOException("Snapshot envelope is too large");
        }
        FileOutputStream output = null;
        try {
            output = snapshotFile.startWrite();
            output.write(envelope);
            snapshotFile.finishWrite(output);
        } catch (IOException error) {
            if (output != null) snapshotFile.failWrite(output);
            throw error;
        }
    }

    private SecretKey keyForWrite() throws GeneralSecurityException, IOException {
        KeyStore keyStore = keyStore();
        Key existing = keyStore.getKey(SNAPSHOT_KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        if (existing != null) keyStore.deleteEntry(SNAPSHOT_KEY_ALIAS);

        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
        generator.init(new KeyGenParameterSpec.Builder(
                SNAPSHOT_KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private SecretKey existingKey() throws GeneralSecurityException, IOException {
        Key key = keyStore().getKey(SNAPSHOT_KEY_ALIAS, null);
        if (!(key instanceof SecretKey)) {
            throw new GeneralSecurityException("Snapshot key is missing");
        }
        return (SecretKey) key;
    }

    private KeyStore keyStore() throws GeneralSecurityException, IOException {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
        keyStore.load(null);
        return keyStore;
    }

    static byte[] readBounded(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8 * 1024];
        int size = 0;
        while (true) {
            int remaining = MAX_ENVELOPE_BYTES - size;
            int count = input.read(buffer, 0, Math.min(buffer.length, remaining + 1));
            if (count == -1) return output.toByteArray();
            if (count == 0) continue;
            if (count > remaining) throw new IOException("Snapshot envelope is too large");
            output.write(buffer, 0, count);
            size += count;
        }
    }
}
