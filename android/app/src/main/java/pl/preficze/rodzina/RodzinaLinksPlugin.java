package pl.preficze.rodzina;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RodzinaLinks")
public class RodzinaLinksPlugin extends Plugin {
    @PluginMethod
    public void copy(PluginCall call) {
        String text = call.getString("url");
        if (text == null) { call.reject("Brak linku."); return; }
        getActivity().runOnUiThread(() -> {
            try {
                ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
                clipboard.setPrimaryClip(ClipData.newPlainText("Rodzina", text));
                call.resolve();
            } catch (Exception error) { call.reject("Nie udało się skopiować linku."); }
        });
    }

    @PluginMethod
    public void share(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("Brak linku."); return; }
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_TEXT, url);
                intent.putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "Rodzina"));
                getActivity().startActivity(Intent.createChooser(intent, null));
                call.resolve();
            } catch (Exception error) { call.reject("Nie udało się udostępnić linku."); }
        });
    }
}
