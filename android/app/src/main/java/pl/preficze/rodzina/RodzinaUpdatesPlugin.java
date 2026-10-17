package pl.preficze.rodzina;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import okhttp3.Call;
import okhttp3.CookieJar;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Public release traffic is deliberately isolated from the session transport. */
@CapacitorPlugin(name = "RodzinaUpdates")
public class RodzinaUpdatesPlugin extends Plugin {
    private static final String ORIGIN = "https://rodzina.preficze.pl";
    private static final long MAX_BYTES = 200L * 1024 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final OkHttpClient http = new OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
        .followRedirects(false).followSslRedirects(false).callTimeout(5, TimeUnit.MINUTES)
        .connectTimeout(20, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build();
    private volatile Call transfer;
    private volatile boolean cancelled;
    private boolean downloading;
    private File verifiedFile;
    private String verifiedHash;

    @PluginMethod
    public void latest(PluginCall call) {
        executor.execute(() -> {
            try (Response response = http.newBuilder().callTimeout(20, TimeUnit.SECONDS).build().newCall(new Request.Builder().url(ORIGIN + "/downloads/android/latest.json")
                    .header("Cache-Control", "no-cache, no-store").build()).execute()) {
                if (response.code() == 404) { call.resolve(new JSObject().put("available", false)); return; }
                if (!response.isSuccessful() || response.body() == null) throw new IOException();
                // Bound the response even when Content-Length is absent or dishonest.
                java.io.ByteArrayOutputStream metadata = new java.io.ByteArrayOutputStream();
                java.io.InputStream stream = response.body().byteStream();
                byte[] buffer = new byte[1024];
                int size;
                while ((size = stream.read(buffer)) != -1) {
                    if (metadata.size() + size > 4096) throw new IOException();
                    metadata.write(buffer, 0, size);
                }
                byte[] bytes = metadata.toByteArray();
                call.resolve(new JSObject().put("available", true).put("release", new JSObject(new String(bytes, java.nio.charset.StandardCharsets.UTF_8))));
            } catch (Exception error) { call.reject("Nie udało się sprawdzić wersji. Sprawdź połączenie i spróbuj ponownie."); }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        synchronized (this) {
            if (downloading) { call.reject("Pobieranie już trwa."); return; }
            downloading = true;
            cancelled = false;
        }
        executor.execute(() -> {
            File partial = null;
            try {
                int code = call.getInt("versionCode", 0);
                String name = call.getString("versionName", "");
                String url = call.getString("apkUrl", "");
                String hash = call.getString("sha256", "");
                if (code <= installedCode() || !name.matches("\\d+\\.\\d+\\.\\d+(?:-[a-zA-Z0-9.-]+)?") || name.length() > 80
                    || !hash.matches("[a-fA-F0-9]{64}") || !url.equals(ORIGIN + "/downloads/android/rodzina-" + code + "-" + name + ".apk"))
                    throw new IOException("Nieprawidłowe dane wydania.");
                File directory = new File(getContext().getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Nie można utworzyć pliku aktualizacji.");
                verifiedFile = null;
                for (File old : directory.listFiles() == null ? new File[0] : directory.listFiles()) old.delete();
                partial = new File(directory, "download.part");
                transfer = http.newCall(new Request.Builder().url(url).header("Cache-Control", "no-store").build());
                if (cancelled) throw new IOException("Anulowano pobieranie.");
                try (Response response = transfer.execute()) {
                    if (!response.isSuccessful() || response.body() == null) throw new IOException("Nie udało się pobrać APK.");
                    long total = response.body().contentLength();
                    if (total > MAX_BYTES) throw new IOException("Plik APK jest zbyt duży.");
                    long required = (total > 0 ? total : MAX_BYTES) + 32L * 1024 * 1024;
                    if (new StatFs(directory.getAbsolutePath()).getAvailableBytes() < required) throw new IOException("Brak miejsca na aktualizację. Zwolnij miejsce i spróbuj ponownie.");
                    long[] lastProgress = { 0 };
                    try (java.io.InputStream input = response.body().byteStream(); FileOutputStream output = new FileOutputStream(partial)) {
                        UpdateTransfer.copy(input, output, total, hash, () -> cancelled,
                          () -> new StatFs(directory.getAbsolutePath()).getAvailableBytes(), count -> {
                            long now = android.os.SystemClock.elapsedRealtime();
                            if (now - lastProgress[0] > 200) {
                                notifyListeners("progress", new JSObject().put("received", count).put("total", total));
                                lastProgress[0] = now;
                            }
                          });
                        output.getFD().sync();
                    }
                }
                if (cancelled) throw new IOException("Anulowano pobieranie.");
                PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(partial.getAbsolutePath(), 0);
                if (info == null || !info.packageName.equals(getContext().getPackageName()) || versionCode(info) != code || !name.equals(info.versionName)) throw new IOException("APK nie pasuje do wydania aplikacji.");
                File ready = new File(directory, "update.apk");
                if (!partial.renameTo(ready)) throw new IOException("Nie można zapisać aktualizacji.");
                verifiedFile = ready;
                verifiedHash = hash;
                call.resolve();
            } catch (Exception error) {
                if (partial != null) partial.delete();
                String message = error.getMessage();
                // Network exceptions may contain implementation details or English messages.
                boolean readable = message != null && (message.startsWith("Nieprawidłowe") || message.startsWith("Nie można") || message.startsWith("Nie udało") || message.startsWith("Brak miejsca") || message.startsWith("Suma SHA-256") || message.startsWith("APK nie") || message.startsWith("Plik APK"));
                call.reject(cancelled ? "Anulowano pobieranie." : readable ? message : "Pobieranie przerwane. Sprawdź połączenie i spróbuj ponownie.");
            } finally {
                transfer = null;
                synchronized (this) { downloading = false; }
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        Call active = transfer;
        if (active != null) active.cancel();
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        executor.execute(() -> {
            try {
                File file = verifiedFile;
                if (file == null || !file.isFile()) throw new IOException("Pobierz APK ponownie.");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (FileInputStream input = new FileInputStream(file)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
                }
                if (!hex(digest.digest()).equalsIgnoreCase(verifiedHash)) throw new IOException("Plik aktualizacji jest uszkodzony. Pobierz APK ponownie.");
                if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    call.resolve(new JSObject().put("needsPermission", true)); return;
                }
                getActivity().runOnUiThread(() -> {
                    try {
                        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                        Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri, "application/vnd.android.package-archive")
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).putExtra(Intent.EXTRA_RETURN_RESULT, true);
                        intent.setClipData(android.content.ClipData.newRawUri("APK", uri));
                        startActivityForResult(call, intent, "installed");
                    } catch (Exception error) { call.reject("Nie można otworzyć instalatora Androida."); }
                });
            } catch (Exception error) { call.reject(error.getMessage() == null ? "Nie można sprawdzić APK." : error.getMessage()); }
        });
    }

    @ActivityCallback
    private void installed(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(new JSObject().put("installerReturned", true));
        // Returning from the installer never constitutes proof of a successful update.
    }

    @PluginMethod
    public void settings(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) { call.resolve(); return; }
        getActivity().runOnUiThread(() -> {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
                call.resolve();
            } catch (Exception error) { call.reject("Nie można otworzyć zgody na instalację. Otwórz ustawienia aplikacji w Androidzie."); }
        });
    }

    private long installedCode() throws Exception {
        return versionCode(getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0));
    }
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }
}
