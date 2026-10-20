package pl.preficze.rodzina;

import android.content.pm.ApplicationInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.HttpCookie;
import java.net.URI;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.CookieJar;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

@CapacitorPlugin(name = "RodzinaApi")
public class RodzinaApiPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    // Never use Capacitor's global CookieHandler, which mirrors cookies into WebView.
    private final OkHttpClient http = new OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .callTimeout(20, TimeUnit.SECONDS).build();
    private SessionStore sessions;

    @Override
    public void load() {
        sessions = new SessionStore(getContext());
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        executor.execute(() -> {
            try {
                sessions.clear();
                call.resolve();
            } catch (Exception error) {
                call.reject("Nie udało się usunąć sesji z urządzenia.");
            }
        });
    }

    @PluginMethod
    public void request(PluginCall call) {
        executor.execute(() -> execute(call));
    }

    private void execute(PluginCall call) {
        String path = call.getString("path", "");
        String method = call.getString("method", "GET");
        boolean logout = path.equals("/api/auth/logout");
        try {
            String origin = getConfig().getString("apiOrigin", "https://rodzina.preficze.pl");
            boolean debug = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
            if (!origin.equals("https://rodzina.preficze.pl") && !(debug && origin.equals("http://localhost:3000"))) {
                throw new IllegalArgumentException("Invalid API origin");
            }
            URI relative = new URI(path);
            if (!path.startsWith("/api/") || relative.isAbsolute() || relative.getRawAuthority() != null
                || relative.getFragment() != null || !relative.normalize().toString().equals(path)
                || path.contains("\\") || relative.getRawPath().contains("%")
                || !Arrays.asList("GET", "POST", "PATCH", "PUT", "DELETE").contains(method)) {
                throw new IllegalArgumentException("Invalid API request");
            }
            // Login never inherits credentials from another account, even after a failed attempt.
            if (path.equals("/api/auth/login") || path.equals("/api/auth/login-child")
                || path.equals("/api/auth/register-family") || path.matches("/api/invitations/[^/]+/accept")) {
                sessions.clear();
            }
            Request.Builder request = new Request.Builder().url(origin + path).header("Accept", "application/json")
                .header("Cache-Control", "no-store");
            String token = sessions.read(origin);
            if (token != null) request.header("Cookie", "sid=" + token);
            if (!method.equals("GET")) {
                request.header("Origin", origin).method(method,
                    RequestBody.create(MediaType.get("application/json"), call.getString("body", "{}")));
            }
            try (Response response = http.newCall(request.build()).execute()) {
                int status = response.code();
                if (status == 403 && relative.getPath().equals("/api/reminders/schedule")) {
                    synchronized (AlarmStore.LOCK) { new AlarmStore(getContext()).clear(); }
                }
                if (status == 401) sessions.clear();
                else if (!logout) {
                    for (String value : response.headers("Set-Cookie")) {
                        for (HttpCookie cookie : HttpCookie.parse(value)) {
                            if (!cookie.getName().equals("sid")) continue;
                            if (cookie.getMaxAge() <= 0 || !cookie.getValue().matches("[a-f0-9]{64}")) sessions.clear();
                            else sessions.write(origin, cookie.getValue(), System.currentTimeMillis() + cookie.getMaxAge() * 1000);
                        }
                    }
                }
                String body = response.body() == null ? "" : response.body().string();
                if (logout) sessions.clear();
                JSObject result = new JSObject();
                result.put("status", status);
                result.put("body", body);
                call.resolve(result);
            }
        } catch (Exception error) {
            // Do not expose URLs, credentials or server response headers to JavaScript/logcat.
            if (logout) {
                try { sessions.clear(); } catch (Exception ignored) {
                    call.reject("Nie udało się usunąć sesji z urządzenia.");
                    return;
                }
            }
            call.reject("Nie udało się połączyć z API. Sprawdź połączenie i spróbuj ponownie.");
        }
    }
}
