package pl.preficze.rodzina;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SessionStore {
    private static final String ALIAS = "rodzina.session.v1";
    private final SharedPreferences preferences;
    private final Context context;

    SessionStore(Context context) {
        this.context = context;
        preferences = context.getSharedPreferences("rodzina.session", Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }

    void clear() {
        synchronized (AlarmStore.LOCK) {
            new AlarmStore(context).clear();
            if (!preferences.edit().clear().commit()) throw new IllegalStateException("Session removal failed");
        }
    }

    String read(String origin) throws Exception {
        String encrypted = preferences.getString("value", null);
        if (encrypted == null) return null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128,
                Base64.decode(preferences.getString("iv", ""), Base64.NO_WRAP)));
            cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
            String plaintext = new String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            String[] parts = plaintext.split(":", 2);
            if (parts.length != 2 || Long.parseLong(parts[0]) <= System.currentTimeMillis()
                || !parts[1].matches("[a-f0-9]{64}")) {
                clear();
                return null;
            }
            return parts[1];
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    void write(String origin, String token, long expiresAt) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        byte[] value = cipher.doFinal((expiresAt + ":" + token).getBytes(StandardCharsets.UTF_8));
        if (!preferences.edit().putString("value", Base64.encodeToString(value, Base64.NO_WRAP))
            .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit()) {
            throw new IllegalStateException("Session save failed");
        }
    }
}
