package pl.preficze.rodzina;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SessionStoreTest {
    @Test
    public void persistsEncryptedSessionAndClearsOnLogoutExpiryOrOriginChange() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SessionStore store = new SessionStore(context);
        String origin = "https://rodzina.preficze.pl";
        String token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        store.clear();
        try {
            store.write(origin, token, System.currentTimeMillis() + 60000);
            assertEquals(token, new SessionStore(context).read(origin));
            String encrypted = context.getSharedPreferences("rodzina.session", Context.MODE_PRIVATE).getString("value", "");
            assertFalse(encrypted.contains(token));
            assertNull(new SessionStore(context).read("http://localhost:3000"));
            store.write(origin, token, System.currentTimeMillis() - 1);
            assertNull(store.read(origin));
            store.write(origin, token, System.currentTimeMillis() + 60000);
            store.clear();
            assertNull(new SessionStore(context).read(origin));
        } finally { store.clear(); }
    }
}
