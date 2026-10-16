package pl.preficze.rodzina;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RodzinaApiPlugin.class);
        registerPlugin(RodzinaAlarmsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
