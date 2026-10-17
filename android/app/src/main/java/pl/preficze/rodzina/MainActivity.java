package pl.preficze.rodzina;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RodzinaApiPlugin.class);
        registerPlugin(RodzinaAlarmsPlugin.class);
        registerPlugin(RodzinaLinksPlugin.class);
        registerPlugin(RodzinaUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
        android.view.View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(content);
        // BridgeActivity forwards the launch intent; LocalNotifications retains its action for JS.
    }
}
