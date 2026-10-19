package pl.preficze.rodzina;

import android.content.Context;
import android.content.SharedPreferences;
import android.app.NotificationManager;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.getcapacitor.CapConfig;
import java.util.UUID;

final class AlarmStore {
    static final Object LOCK = new Object();
    private final Context context;
    private final SharedPreferences preferences;

    AlarmStore(Context context) {
        this.context = context;
        preferences = context.getSharedPreferences("rodzina.alarms.v1", Context.MODE_PRIVATE);
    }

    String revision() {
        String revision = preferences.getString("revision", null);
        if (revision == null) {
            revision = UUID.randomUUID().toString();
            commit(preferences.edit().putString("revision", revision));
        }
        return revision;
    }

    String preview() {
        return preferences.getString("value", null);
    }

    String read(String account) {
        String owner = preferences.getString("account", null);
        if (owner != null && !owner.equals(account)) clear();
        commit(preferences.edit().putString("account", account));
        return preferences.getString("value", null);
    }

    void write(String account, String value, String revision) {
        if (!revision().equals(revision) || !account.equals(preferences.getString("account", null))) {
            throw new IllegalStateException("Account changed");
        }
        commit(preferences.edit().putString("value", value));
    }

    void clear() {
        NotificationStorage storage = new NotificationStorage(context);
        new LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context)).cancelAll();
        context.getSystemService(NotificationManager.class).cancelAll();
        // cancelAll preserves delivered records; remove them too, including their saved contents.
        for (String id : storage.getSavedNotificationIds()) storage.deleteNotification(id);
        new SystemAlarmScheduler(context).clearReceipts();
        commit(preferences.edit().clear().putString("revision", UUID.randomUUID().toString()));
    }

    private void commit(SharedPreferences.Editor editor) {
        if (!editor.commit()) throw new IllegalStateException("Alarm storage failed");
    }
}
