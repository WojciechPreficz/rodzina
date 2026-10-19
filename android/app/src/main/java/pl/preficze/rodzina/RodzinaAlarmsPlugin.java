package pl.preficze.rodzina;

import android.app.ActivityManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "RodzinaAlarms")
public class RodzinaAlarmsPlugin extends Plugin {
    @PluginMethod
    public void runtimeStatus(PluginCall call) {
        ActivityManager manager = getContext().getSystemService(ActivityManager.class);
        JSObject result = new JSObject();
        result.put("backgroundRestricted", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            && manager != null && manager.isBackgroundRestricted());
        result.put("manufacturer", Build.MANUFACTURER);
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception error) {
                call.reject("Nie udało się otworzyć ustawień aplikacji. Otwórz je w ustawieniach telefonu.");
            }
        });
    }

    @PluginMethod
    public void preview(PluginCall call) {
        synchronized (AlarmStore.LOCK) {
            try {
                String origin = getBridge().getConfig().getPluginConfiguration("RodzinaApi")
                    .getString("apiOrigin", "https://rodzina.preficze.pl");
                String session = new SessionStore(getContext()).read(origin);
                String value = session == null ? null : new AlarmStore(getContext()).preview();
                JSObject result = new JSObject();
                result.put("value", value == null ? JSONObject.NULL : value);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Nie udało się odczytać zapisanego przypomnienia.");
            }
        }
    }
    @PluginMethod
    public void read(PluginCall call) {
        synchronized (AlarmStore.LOCK) {
            try {
                String account = call.getString("account");
                if (account == null || account.isEmpty()) throw new IllegalArgumentException();
                AlarmStore store = new AlarmStore(getContext());
                String value = store.read(account);
                JSObject result = new JSObject();
                result.put("value", value == null ? JSONObject.NULL : value);
                result.put("revision", store.revision());
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Nie udało się odczytać harmonogramu z urządzenia.");
            }
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        synchronized (AlarmStore.LOCK) {
            try {
                String value = call.getString("value");
                if (value == null) throw new IllegalArgumentException();
                new AlarmStore(getContext()).write(call.getString("account"), value, call.getString("revision"));
                call.resolve();
            } catch (Exception error) {
                call.reject("Nie udało się zapisać harmonogramu. Sprawdź aktywne konto.");
            }
        }
    }
}
