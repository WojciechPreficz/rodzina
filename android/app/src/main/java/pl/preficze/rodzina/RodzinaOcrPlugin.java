package pl.preficze.rodzina;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia;
import androidx.exifinterface.media.ExifInterface;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

@CapacitorPlugin(name = "RodzinaOcr")
public class RodzinaOcrPlugin extends Plugin {
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile Run active;
    private volatile Run processing;
    // A cancelled system picker must return before another picker can be launched.
    private Run picker;

    @Override
    public void load() {
        // Process death may interrupt cleanup. These files never belong to account storage.
        File directory = new File(getContext().getCacheDir(), "photo-ocr");
        File[] stale = directory.listFiles();
        if (stale != null) for (File file : stale) if (file.isFile()) file.delete();
    }

    private static final class Run {
        final String id;
        final PluginCall call;
        volatile boolean cancelled;
        Run(String id, PluginCall call) { this.id = id; this.call = call; }
        void check() { if (cancelled) throw new CancellationException(); }
    }

    @PluginMethod
    public void pickAndRecognize(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String id = call.getString("requestId");
            if (id == null || id.length() > 100) { call.reject("Nieprawidłowy odczyt."); return; }
            if (active != null || picker != null || processing != null) { call.reject("Zakończ poprzedni wybór zdjęcia i spróbuj ponownie."); return; }
            Run run = new Run(id, call);
            active = picker = run;
            try {
                Intent intent = new PickVisualMedia().createIntent(getContext(), new PickVisualMediaRequest.Builder()
                    .setMediaType(PickVisualMedia.ImageOnly.INSTANCE).build());
                startActivityForResult(call, intent, "picked");
            } catch (Exception error) {
                picker = null;
                finish(run, null, "Nie można otworzyć selektora zdjęć.");
            }
        });
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        Run run = picker;
        picker = null;
        if (run == null || run.cancelled || active != run) return;
        Uri uri = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            finish(run, new JSObject().put("cancelled", true), null);
            return;
        }
        processing = run;
        worker.execute(() -> read(run, uri));
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            Run run = active;
            if (run != null && run.id.equals(call.getString("requestId"))) {
                run.cancelled = true;
                active = null;
                run.call.reject("Odczyt anulowany.");
            }
            call.resolve();
        });
    }

    private void finish(Run run, JSObject result, String error) {
        getActivity().runOnUiThread(() -> {
            if (active != run || run.cancelled) return;
            active = null;
            if (error != null) run.call.reject(error);
            else run.call.resolve(result);
        });
    }

    private void read(Run run, Uri uri) {
        File source = null;
        Bitmap bitmap = null;
        TextRecognizer recognizer = null;
        boolean handedOff = false;
        try {
            run.check();
            if (!"content".equals(uri.getScheme())) throw new IllegalArgumentException("Nie można odczytać zdjęcia.");
            String mime = getContext().getContentResolver().getType(uri);
            if (!OcrImagePolicy.supported(mime)) throw new IllegalArgumentException("Wybierz zdjęcie JPEG, PNG lub WebP.");
            File directory = new File(getContext().getCacheDir(), "photo-ocr");
            if (!directory.isDirectory() && !directory.mkdir()) throw new java.io.IOException();
            source = File.createTempFile("source-", ".image", directory);
            try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                 FileOutputStream output = new FileOutputStream(source)) {
                if (input == null) throw new IllegalArgumentException("Nie można odczytać zdjęcia.");
                byte[] buffer = new byte[16 * 1024];
                int total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    run.check();
                    total += count;
                    if (total > OcrImagePolicy.MAX_BYTES) throw new IllegalArgumentException("Zdjęcie przekracza limit 20 MB.");
                    output.write(buffer, 0, count);
                }
                if (total == 0) throw new IllegalArgumentException("Plik jest pusty lub uszkodzony.");
            }
            run.check();
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(source.getPath(), bounds);
            if (!OcrImagePolicy.supported(bounds.outMimeType)) throw new IllegalArgumentException("Plik jest uszkodzony lub nieobsługiwany.");
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = OcrImagePolicy.sampleSize(bounds.outWidth, bounds.outHeight);
            options.inPreferredConfig = Bitmap.Config.ARGB_8888;
            bitmap = BitmapFactory.decodeFile(source.getPath(), options);
            if (bitmap == null) throw new IllegalArgumentException("Nie można odczytać zdjęcia.");
            ExifInterface exif = new ExifInterface(source);
            Matrix matrix = new Matrix();
            // ExifInterface defines rotation after horizontal mirroring (not before).
            if (exif.isFlipped()) matrix.postScale(-1, 1);
            matrix.postRotate(exif.getRotationDegrees());
            int[] size = OcrImagePolicy.size(bitmap.getWidth(), bitmap.getHeight(), OcrImagePolicy.MAX_SIDE);
            matrix.postScale(size[0] / (float) bitmap.getWidth(), size[1] / (float) bitmap.getHeight());
            Bitmap oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
            if (oriented != bitmap) bitmap.recycle();
            bitmap = oriented;
            run.check();
            String preview = preview(bitmap);
            recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            recognize(run, bitmap, recognizer, preview);
            // Each asynchronous pass retains its input until the completion callback.
            bitmap = null;
            recognizer = null;
            handedOff = true;
        } catch (CancellationException ignored) {
            // No image or raw OCR is logged.
        } catch (OutOfMemoryError error) {
            finish(run, null, "Za mało pamięci. Wybierz mniejsze zdjęcie.");
        } catch (Exception error) {
            finish(run, null, error instanceof IllegalArgumentException ? error.getMessage() : "Nie można odczytać zdjęcia. Spróbuj ponownie.");
        } finally {
            if (bitmap != null) bitmap.recycle();
            if (recognizer != null) recognizer.close();
            if (source != null && !source.delete()) source.deleteOnExit();
            if (!handedOff) processing = null;
        }
    }

    private void recognize(Run run, Bitmap original, TextRecognizer recognizer, String preview) {
        recognizer.process(InputImage.fromBitmap(original, 0))
                .addOnCompleteListener(worker, task -> {
                    Bitmap enhanced = null;
                    JSObject first = null;
                    boolean handedOff = false;
                    try {
                        run.check();
                        if (!task.isSuccessful()) throw new IllegalStateException();
                        int width = original.getWidth();
                        int height = original.getHeight();
                        first = document(task.getResult(), width, height);
                        enhanced = contrast(original);
                        run.check();
                        Bitmap owned = enhanced;
                        JSObject primary = first;
                        recognizer.process(InputImage.fromBitmap(enhanced, 0)).addOnCompleteListener(worker, second -> {
                            boolean refining = false;
                            try {
                                run.check();
                                JSObject result = new JSObject().put("document", primary).put("preview", preview);
                                if (second.isSuccessful()) result.put("alternateDocument", document(second.getResult(), owned.getWidth(), owned.getHeight()));
                                List<Rect> fragments = new ArrayList<>();
                                for (Text.TextBlock block : task.getResult().getTextBlocks()) for (Text.Line line : block.getLines()) {
                                    if (fragments.size() >= 32) break;
                                    if (line.getBoundingBox() != null && OcrImagePolicy.refineLine(line.getText(), line.getConfidence()))
                                        fragments.add(new Rect(line.getBoundingBox()));
                                }
                                refine(run, original, recognizer, result, fragments, 0, new JSArray());
                                refining = true;
                            } catch (CancellationException ignored) {
                                // Cancellation must not publish either pass.
                            } catch (Exception | OutOfMemoryError error) {
                                finish(run, new JSObject().put("document", primary).put("preview", preview), null);
                            } finally {
                                owned.recycle();
                                if (!refining) {
                                    original.recycle();
                                    recognizer.close();
                                    processing = null;
                                }
                            }
                        });
                        handedOff = true;
                    } catch (CancellationException ignored) {
                        // Cancellation already settled the call; never return a stale result.
                    } catch (Exception | OutOfMemoryError error) {
                        // The optional enhancement must not discard a completed original read.
                        if (first != null) finish(run, new JSObject().put("document", first).put("preview", preview), null);
                        else finish(run, null, "Nie udało się odczytać tekstu ze zdjęcia.");
                    } finally {
                        if (!handedOff) {
                            original.recycle();
                            if (enhanced != null) enhanced.recycle();
                            recognizer.close();
                            processing = null;
                        }
                    }
                });
    }

    private void refine(Run run, Bitmap original, TextRecognizer recognizer, JSObject result,
                        List<Rect> fragments, int index, JSArray lines) {
        Bitmap crop = null;
        boolean handedOff = false;
        try {
            run.check();
            if (index >= fragments.size()) {
                result.put("refinedDocument", new JSObject()
                    .put("image", new JSObject().put("width", original.getWidth()).put("height", original.getHeight()))
                    .put("lines", lines));
                finish(run, result, null);
                return;
            }
            Rect box = fragments.get(index);
            box.inset(-8, -8);
            box.intersect(0, 0, original.getWidth(), original.getHeight());
            int[] size = OcrImagePolicy.contrastSize(box.width(), box.height());
            crop = Bitmap.createBitmap(size[0], size[1], Bitmap.Config.ARGB_8888);
            new Canvas(crop).drawBitmap(original, box, new Rect(0, 0, size[0], size[1]), new Paint(Paint.FILTER_BITMAP_FLAG));
            Bitmap owned = crop;
            recognizer.process(InputImage.fromBitmap(crop, 0)).addOnCompleteListener(worker, task -> {
                try {
                    run.check();
                    if (task.isSuccessful()) {
                        org.json.JSONArray recovered = document(task.getResult(), owned.getWidth(), owned.getHeight()).getJSONArray("lines");
                        for (int i = 0; i < recovered.length(); i++) {
                            org.json.JSONObject item = recovered.getJSONObject(i);
                            org.json.JSONObject local = item.getJSONObject("box");
                            item.put("id", "refined-" + lines.length());
                            item.put("box", new JSObject()
                                .put("x", (box.left + local.getDouble("x") * box.width()) / original.getWidth())
                                .put("y", (box.top + local.getDouble("y") * box.height()) / original.getHeight())
                                .put("width", local.getDouble("width") * box.width() / original.getWidth())
                                .put("height", local.getDouble("height") * box.height() / original.getHeight()));
                            lines.put(item);
                        }
                    }
                } catch (CancellationException ignored) {
                    // The next iteration releases the retained original without publishing it.
                } catch (Exception ignored) {
                    // An optional fragment must not discard completed whole-image reads.
                } finally {
                    owned.recycle();
                    refine(run, original, recognizer, result, fragments, index + 1, lines);
                }
            });
            handedOff = true;
        } catch (CancellationException ignored) {
            // Cancellation invalidates every pending fragment.
        } catch (Exception | OutOfMemoryError ignored) {
            finish(run, result, null);
        } finally {
            if (!handedOff) {
                if (crop != null) crop.recycle();
                original.recycle();
                recognizer.close();
                processing = null;
            }
        }
    }

    private static Bitmap contrast(Bitmap original) {
        int[] size = OcrImagePolicy.contrastSize(original.getWidth(), original.getHeight());
        Bitmap result = Bitmap.createBitmap(size[0], size[1], Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(result);
            canvas.drawColor(Color.WHITE);
            ColorMatrix gray = new ColorMatrix();
            gray.setSaturation(0);
            ColorMatrix gain = new ColorMatrix(new float[] {
                1.6f, 0, 0, 0, -60, 0, 1.6f, 0, 0, -60, 0, 0, 1.6f, 0, -60, 0, 0, 0, 1, 0
            });
            gain.postConcat(gray);
            Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG);
            paint.setColorFilter(new ColorMatrixColorFilter(gain));
            canvas.drawBitmap(original, null, new Rect(0, 0, size[0], size[1]), paint);
            return result;
        } catch (Exception | OutOfMemoryError error) {
            result.recycle();
            throw error;
        }
    }

    private static String preview(Bitmap bitmap) {
        int[] size = OcrImagePolicy.size(bitmap.getWidth(), bitmap.getHeight(), 640);
        Bitmap small = Bitmap.createScaledBitmap(bitmap, size[0], size[1], true);
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            small.compress(Bitmap.CompressFormat.JPEG, 65, bytes);
            if (bytes.size() > 256 * 1024) return null;
            return "data:image/jpeg;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } catch (java.io.IOException error) {
            return null;
        } finally {
            if (small != bitmap) small.recycle();
        }
    }

    private static JSObject document(Text text, int width, int height) {
        JSArray lines = new JSArray();
        int id = 0;
        for (Text.TextBlock block : text.getTextBlocks()) for (Text.Line line : block.getLines()) {
            List<List<Text.Element>> fragments = new ArrayList<>();
            List<Text.Element> elements = new ArrayList<>(line.getElements());
            elements.removeIf(element -> element.getBoundingBox() == null);
            elements.sort(Comparator.comparingInt(element -> element.getBoundingBox().left));
            Text.Element previous = null;
            for (Text.Element element : elements) {
                Rect box = element.getBoundingBox();
                Rect old = previous == null ? null : previous.getBoundingBox();
                if (old == null || OcrImagePolicy.separateWords(old.right, old.centerY(), box.left, box.centerY(), Math.min(old.height(), box.height()))) fragments.add(new ArrayList<>());
                fragments.get(fragments.size() - 1).add(element);
                previous = element;
            }
            if (fragments.isEmpty()) fragments.add(new ArrayList<>());
            for (List<Text.Element> fragment : fragments) {
                Rect box = fragments.size() == 1 ? line.getBoundingBox() : null;
                String value = line.getText();
                if (fragments.size() > 1) {
                    StringBuilder joined = new StringBuilder();
                    for (Text.Element element : fragment) {
                        if (box == null) box = new Rect(element.getBoundingBox()); else box.union(element.getBoundingBox());
                        if (joined.length() > 0) joined.append(' ');
                        joined.append(element.getText());
                    }
                    value = joined.toString();
                }
                if (box == null || value.trim().isEmpty()) continue;
                double[] normalized = OcrImagePolicy.box(box.left, box.top, box.right, box.bottom, width, height);
                if (normalized == null) continue;
                if (++id > 10000 || value.length() > 10000) throw new IllegalArgumentException();
                JSObject item = new JSObject().put("id", "line-" + id).put("text", value.trim())
                    .put("box", new JSObject().put("x", normalized[0]).put("y", normalized[1]).put("width", normalized[2]).put("height", normalized[3]));
                if (Float.isFinite(line.getConfidence()) && line.getConfidence() > 0) item.put("confidence", Math.min(100, line.getConfidence() * 100));
                lines.put(item);
            }
        }
        return new JSObject().put("image", new JSObject().put("width", width).put("height", height)).put("lines", lines);
    }

    @Override
    protected void handleOnDestroy() {
        Run run = active;
        if (run != null) { run.cancelled = true; run.call.reject("Odczyt anulowany."); }
        active = null;
        picker = null;
        // Do not shut down the executor: an in-flight ML Kit task still needs its cleanup callback.
    }
}
