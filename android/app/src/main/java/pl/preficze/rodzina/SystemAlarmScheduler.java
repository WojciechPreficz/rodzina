package pl.preficze.rodzina;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.UserManager;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;
import com.getcapacitor.CapConfig;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;

/** Uses the plugin's durable payload and receiver, replacing only the OS alarm mode. */
final class SystemAlarmScheduler {
    private static final String CHANNEL = "calendar-reminders-v1";
    private final Context context;
    private final NotificationStorage storage;
    private final SharedPreferences receipts;
    private final AlarmManager manager;

    SystemAlarmScheduler(Context context) {
        this.context = context;
        storage = new NotificationStorage(context);
        receipts = context.getSharedPreferences("rodzina.system-alarms.v1", Context.MODE_PRIVATE);
        manager = context.getSystemService(AlarmManager.class);
    }

    private List<SystemAlarmReconciler.Alarm> futureAlarms() {
        List<SystemAlarmReconciler.Alarm> alarms = new ArrayList<>();
        for (LocalNotification notification : storage.getSavedNotifications()) {
            if (!CHANNEL.equals(notification.getChannelId()) || notification.getCancelled()) continue;
            if (notification.getId() == null || notification.getSchedule() == null
                || notification.getSchedule().getAt() == null) continue;
            Object extra = notification.getExtra();
            if (!(extra instanceof JSONObject)) continue;
            String fingerprint = ((JSONObject) extra).optString("fingerprint", "");
            long fireAt = notification.getSchedule().getAt().getTime();
            if (fingerprint.isEmpty() || fireAt <= System.currentTimeMillis()) continue;
            alarms.add(new SystemAlarmReconciler.Alarm(notification.getId(), fireAt, digest(fingerprint)));
        }
        return alarms;
    }

    private static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte item : bytes) result.append(Character.forDigit((item & 255) >>> 4, 16)).append(Character.forDigit(item & 15, 16));
            return result.toString();
        } catch (Exception error) {
            throw new IllegalStateException("Fingerprint hashing failed");
        }
    }

    private Map<Integer, String> readReceipts() {
        Map<Integer, String> result = new HashMap<>();
        for (Map.Entry<String, ?> entry : receipts.getAll().entrySet()) {
            try {
                if (entry.getValue() instanceof String) result.put(Integer.parseInt(entry.getKey()), (String) entry.getValue());
            } catch (NumberFormatException ignored) {}
        }
        return result;
    }

    private PendingIntent operation(int id) {
        Intent intent = new Intent(context, TimedNotificationPublisher.class);
        int flags = PendingIntent.FLAG_NO_CREATE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        return PendingIntent.getBroadcast(context, id, intent, flags);
    }

    private boolean permitted() {
        return manager != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms());
    }

    SystemAlarmReconciler.Result reconcile(Set<Integer> forceIds) {
        UserManager users = context.getSystemService(UserManager.class);
        if (users == null || !users.isUserUnlocked()) return new SystemAlarmReconciler.Result(Collections.emptyList(), Collections.emptyList());
        Map<Integer, String> known = readReceipts();
        SystemAlarmReconciler.Result result = SystemAlarmReconciler.reconcile(
            futureAlarms(), known, forceIds, System.currentTimeMillis(), new SystemAlarmReconciler.Registry() {
                public boolean hasOperation(int id) { return permitted() && operation(id) != null; }
                public void register(SystemAlarmReconciler.Alarm alarm) throws Exception {
                    if (!permitted()) throw new IllegalStateException("Exact alarms unavailable");
                    PendingIntent target = operation(alarm.id());
                    if (target == null) {
                        LocalNotification notification = storage.getSavedNotification(Integer.toString(alarm.id()));
                        if (notification == null) throw new IllegalStateException("Notification unavailable");
                        new LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
                            .schedule(null, Collections.singletonList(notification));
                        target = operation(alarm.id());
                    }
                    if (target == null) throw new IllegalStateException("Alarm operation unavailable");
                    Intent show = new Intent(context, MainActivity.class).setAction(Intent.ACTION_MAIN)
                        .addCategory(Intent.CATEGORY_LAUNCHER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                    PendingIntent showAlarm = PendingIntent.getActivity(context, 0, show,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    manager.setAlarmClock(new AlarmManager.AlarmClockInfo(alarm.fireAt(), showAlarm), target);
                }
            });
        SharedPreferences.Editor editor = receipts.edit().clear();
        for (Map.Entry<Integer, String> entry : known.entrySet()) editor.putString(entry.getKey().toString(), entry.getValue());
        if (!editor.commit()) throw new IllegalStateException("System alarm receipt storage failed");
        return result;
    }

    List<Integer> registeredIds() {
        List<Integer> result = new ArrayList<>();
        if (!permitted()) return result;
        Map<Integer, String> known = readReceipts();
        for (SystemAlarmReconciler.Alarm alarm : futureAlarms()) {
            if (alarm.fingerprint().equals(known.get(alarm.id())) && operation(alarm.id()) != null) result.add(alarm.id());
        }
        return result;
    }

    void clearReceipts() {
        if (!receipts.edit().clear().commit()) throw new IllegalStateException("System alarm receipt removal failed");
    }

    void restore() {
        UserManager users = context.getSystemService(UserManager.class);
        if (users == null || !users.isUserUnlocked()) return;
        clearReceipts();
        reconcile(Collections.emptySet());
    }
}
