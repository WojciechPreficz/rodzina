package pl.preficze.rodzina;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Absolute UTC instants stay unchanged across timezone and wall-clock changes. */
public class AlarmRestoreReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        synchronized (AlarmStore.LOCK) {
            try {
                new SystemAlarmScheduler(context).restore();
            } catch (Exception error) {
                android.util.Log.w("RodzinaAlarms", "System alarm restoration failed");
            }
        }
    }
}
