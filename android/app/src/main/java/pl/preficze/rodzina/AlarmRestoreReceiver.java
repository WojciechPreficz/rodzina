package pl.preficze.rodzina;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.capacitorjs.plugins.localnotifications.LocalNotificationRestoreReceiver;

/** Absolute UTC instants stay unchanged across timezone and wall-clock changes. */
public class AlarmRestoreReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        synchronized (AlarmStore.LOCK) {
            new LocalNotificationRestoreReceiver().onReceive(context, intent);
        }
    }
}
