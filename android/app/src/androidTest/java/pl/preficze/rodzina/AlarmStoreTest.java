package pl.preficze.rodzina;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AlarmStoreTest {
    @Test
    public void persistsAcrossInstancesAndClearsOnAccountChangeAndLogout() {
        Context context = ApplicationProvider.getApplicationContext();
        synchronized (AlarmStore.LOCK) {
            AlarmStore store = new AlarmStore(context);
            store.clear();
            assertNull(store.read("family:adult"));
            String revision = store.revision();
            store.write("family:adult", "snapshot", revision);
            assertEquals("snapshot", new AlarmStore(context).read("family:adult"));
            assertNull(store.read("family:child"));
            assertNotEquals(revision, store.revision());
            try {
                store.write("family:adult", "late response", revision);
                fail("Old account must not overwrite the new one");
            } catch (IllegalStateException expected) { }
            store.write("family:child", "child snapshot", store.revision());
            new SessionStore(context).clear();
            assertNull(store.read("family:child"));
        }
    }
}
