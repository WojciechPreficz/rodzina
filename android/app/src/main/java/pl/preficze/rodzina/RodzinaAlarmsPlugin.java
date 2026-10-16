package pl.preficze.rodzina;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "RodzinaAlarms")
public class RodzinaAlarmsPlugin extends Plugin {
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
