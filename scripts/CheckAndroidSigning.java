import java.io.File;
import java.security.Key;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.UnrecoverableKeyException;
import java.util.Arrays;
import java.io.Console;
import java.util.Map;

/** Check the exact environment values used by Gradle without disclosing secrets. */
class CheckAndroidSigning {
    public static void main(String[] args) {
        if (args.length == 4 && args[0].equals("--build")) {
            interactiveBuild(args);
            return;
        }
        char[] storePassword = System.getenv("RODZINA_ANDROID_STORE_PASSWORD").toCharArray();
        char[] keyPassword = System.getenv("RODZINA_ANDROID_KEY_PASSWORD").toCharArray();
        int status;
        try {
            status = check(storePassword, keyPassword);
        } finally {
            Arrays.fill(storePassword, '\0');
            Arrays.fill(keyPassword, '\0');
        }
        System.exit(status);
    }

    private static void interactiveBuild(String[] args) {
        Console console = System.console();
        if (console == null) {
            System.err.println("Uruchom to polecenie bezposrednio w terminalu, bez przekierowania wyjscia.");
            System.exit(6);
        }
        char[] storePassword = console.readPassword("Haslo keystore: ");
        char[] keyPassword = console.readPassword("Haslo klucza (Enter = takie samo): ");
        if (storePassword == null || keyPassword == null) System.exit(6);
        if (keyPassword.length == 0) keyPassword = storePassword.clone();
        int status = 5;
        try {
            status = check(storePassword, keyPassword);
            if (status == 0) {
                ProcessBuilder build = new ProcessBuilder(args[1], args[2], "release").inheritIO();
                Map<String, String> environment = build.environment();
                environment.put("RODZINA_ANDROID_STORE_PASSWORD", new String(storePassword));
                environment.put("RODZINA_ANDROID_KEY_PASSWORD", new String(keyPassword));
                status = build.start().waitFor();
                environment.remove("RODZINA_ANDROID_STORE_PASSWORD");
                environment.remove("RODZINA_ANDROID_KEY_PASSWORD");
                if (status == 0) {
                    ProcessBuilder pack = new ProcessBuilder(args[1], args[3]).inheritIO();
                    pack.environment().remove("RODZINA_ANDROID_STORE_PASSWORD");
                    pack.environment().remove("RODZINA_ANDROID_KEY_PASSWORD");
                    status = pack.start().waitFor();
                }
            }
        } catch (Exception error) {
            status = 5;
            System.err.println("Nie udalo sie uruchomic budowania APK.");
        } finally {
            Arrays.fill(storePassword, '\0');
            Arrays.fill(keyPassword, '\0');
        }
        System.exit(status);
    }

    private static int check(char[] storePassword, char[] keyPassword) {
        try {
            KeyStore store;
            try {
                store = KeyStore.getInstance(new File(System.getenv("RODZINA_ANDROID_KEYSTORE")), storePassword);
            } catch (Exception error) {
                return fail("SIGNING_STORE_PASSWORD_INVALID", 2);
            }
            String alias = System.getenv("RODZINA_ANDROID_KEY_ALIAS");
            if (!store.isKeyEntry(alias)) {
                return fail("SIGNING_ALIAS_INVALID", 3);
            }
            Key key;
            try {
                key = store.getKey(alias, keyPassword);
            } catch (UnrecoverableKeyException error) {
                return fail("SIGNING_KEY_PASSWORD_INVALID", 4);
            }
            if (!(key instanceof PrivateKey)) {
                return fail("SIGNING_ALIAS_INVALID", 3);
            }
            System.out.println("SIGNING_OK");
            return 0;
        } catch (Exception error) {
            return fail("SIGNING_CHECK_FAILED", 5);
        }
    }

    private static int fail(String code, int status) {
        System.err.println(code);
        return status;
    }
}
