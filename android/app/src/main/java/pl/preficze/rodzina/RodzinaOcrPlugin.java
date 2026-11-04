package pl.preficze.rodzina;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.net.Uri;
import android.util.AtomicFile;
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
import com.googlecode.tesseract.android.ResultIterator;
import com.googlecode.tesseract.android.TessBaseAPI;
import static com.googlecode.tesseract.android.TessBaseAPI.PageIteratorLevel.RIL_TEXTLINE;
import static com.googlecode.tesseract.android.TessBaseAPI.PageIteratorLevel.RIL_WORD;
import static com.googlecode.tesseract.android.TessBaseAPI.PageSegMode.PSM_SINGLE_LINE;
import static com.googlecode.tesseract.android.TessBaseAPI.PageSegMode.PSM_SPARSE_TEXT;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
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
        private TessBaseAPI recognizing;

        Run(String id, PluginCall call) { this.id = id; this.call = call; }
        void check() { if (cancelled) throw new CancellationException(); }

        synchronized void startRecognition(TessBaseAPI engine) {
            check();
            recognizing = engine;
        }

        synchronized void endRecognition() { recognizing = null; }

        synchronized void stopIfCancelled() {
            if (cancelled && recognizing != null) recognizing.stop();
        }

        void cancel() {
            cancelled = true;
            stopIfCancelled();
            call.reject("Odczyt anulowany.");
        }
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
                active = null;
                run.cancel();
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
        TessBaseAPI engine = null;
        try {
            run.check();
            if (!"content".equals(uri.getScheme())) throw new IllegalArgumentException("Nie można odczytać zdjęcia.");
            String mime = getContext().getContentResolver().getType(uri);
            if (!OcrImagePolicy.supported(mime)) throw new IllegalArgumentException("Wybierz zdjęcie JPEG, PNG lub WebP.");
            File directory = new File(getContext().getCacheDir(), "photo-ocr");
            if (!directory.isDirectory() && !directory.mkdir()) throw new IOException();
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
            int[] size = OcrImagePolicy.recognitionSize(bitmap.getWidth(), bitmap.getHeight());
            matrix.preScale(size[0] / (float) bitmap.getWidth(), size[1] / (float) bitmap.getHeight());
            Bitmap oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
            if (oriented != bitmap) bitmap.recycle();
            bitmap = oriented;
            if (source.delete()) source = null;
            run.check();
            String preview = preview(bitmap);
            File data = prepareModel(run);
            engine = new TessBaseAPI(progress -> run.stopIfCancelled());
            if (!engine.init(data.getPath(), "pol", TessBaseAPI.OEM_LSTM_ONLY)) {
                throw new IllegalStateException("Could not initialize Polish OCR data");
            }
            engine.setVariable("user_defined_dpi", "300");
            finish(run, recognize(run, bitmap, engine).put("preview", preview), null);
        } catch (CancellationException ignored) {
            // No image or raw OCR is logged.
        } catch (OutOfMemoryError error) {
            finish(run, null, "Za mało pamięci. Wybierz mniejsze zdjęcie.");
        } catch (Exception | LinkageError error) {
            String message = error instanceof IllegalArgumentException ? error.getMessage() : null;
            finish(run, null, message != null ? message : "Nie udało się odczytać tekstu ze zdjęcia. Spróbuj ponownie.");
        } finally {
            if (bitmap != null) bitmap.recycle();
            if (engine != null) engine.recycle();
            if (source != null && !source.delete()) source.deleteOnExit();
            processing = null;
        }
    }

    private File prepareModel(Run run) throws IOException {
        File data = new File(getContext().getCodeCacheDir(), "photo-ocr");
        File directory = new File(data, "tessdata");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException();
        File model = new File(directory, "pol.traineddata");
        if (model.length() > 0) return data;

        AtomicFile asset = new AtomicFile(model);
        FileOutputStream output = asset.startWrite();
        boolean complete = false;
        try (InputStream input = getContext().getAssets().open("tessdata/pol.traineddata")) {
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                run.check();
                output.write(buffer, 0, count);
            }
            complete = true;
        } finally {
            if (complete) asset.finishWrite(output);
            else asset.failWrite(output);
        }
        return data;
    }

    private JSObject recognize(Run run, Bitmap original, TessBaseAPI engine) {
        int width = original.getWidth();
        int height = original.getHeight();
        List<Line> primary = recognizeLines(run, original, engine, PSM_SPARSE_TEXT);
        JSObject result = new JSObject().put("document", document(primary, width, height));
        for (boolean binary : new boolean[] {false, true}) {
            Bitmap variant = null;
            try {
                variant = imageVariant(run, original, binary);
                List<Line> lines = recognizeLines(run, variant, engine, PSM_SPARSE_TEXT);
                result.put(binary ? "binaryDocument" : "alternateDocument",
                    document(lines, variant.getWidth(), variant.getHeight()));
            } catch (RuntimeException | OutOfMemoryError ignored) {
                // Keep completed reads if preparing or reading a variant fails.
                run.check();
            } finally {
                if (variant != null) variant.recycle();
            }
        }

        List<Line> refined = new ArrayList<>();
        int attempted = 0;
        for (Line line : primary) {
            run.check();
            if (!OcrImagePolicy.refineLine(line.text(), line.confidence())) continue;
            if (attempted++ == 32) break;
            Bitmap crop = null;
            try {
                Rect box = new Rect(line.box());
                box.inset(-8, -8);
                if (!box.intersect(0, 0, width, height)) continue;
                int[] size = OcrImagePolicy.contrastSize(box.width(), box.height());
                crop = scaledRegion(original, box, size[0], size[1]);
                List<Line> recovered = recognizeLines(run, crop, engine, PSM_SINGLE_LINE);
                if (recovered.size() == 1) {
                    Line reading = recovered.get(0);
                    refined.add(new Line(reading.text(), line.box(), reading.confidence()));
                }
            } catch (RuntimeException | OutOfMemoryError ignored) {
                run.check();
            } finally {
                if (crop != null) crop.recycle();
            }
        }
        return result.put("refinedDocument", document(refined, width, height));
    }

    private static List<Line> recognizeLines(Run run, Bitmap image, TessBaseAPI engine,
                                             @TessBaseAPI.PageSegMode.Mode int mode) {
        run.check();
        try {
            engine.setPageSegMode(mode);
            engine.setImage(image);
            run.startRecognition(engine);
            try {
                // The wrapper only provides native cancellation through this entry point.
                engine.getHOCRText(0);
            } finally {
                run.endRecognition();
            }
            run.check();
            return readLines(run, engine);
        } finally {
            engine.clear();
        }
    }

    private static Bitmap scaledRegion(Bitmap original, Rect region, int width, int height) {
        Bitmap result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(result);
            canvas.drawColor(Color.WHITE);
            canvas.drawBitmap(original, region, new Rect(0, 0, width, height), new Paint(Paint.FILTER_BITMAP_FLAG));
            return result;
        } catch (RuntimeException | OutOfMemoryError error) {
            result.recycle();
            throw error;
        }
    }

    private static Bitmap imageVariant(Run run, Bitmap original, boolean binary) {
        run.check();
        double scale = binary ? 0.75 : 1;
        int width = Math.max(1, (int) Math.round(original.getWidth() * scale));
        int height = Math.max(1, (int) Math.round(original.getHeight() * scale));
        Bitmap result = scaledRegion(original, null, width, height);
        try {
            int[] pixels = new int[width];
            for (int y = 0; y < height; y++) {
                if (y % 128 == 0) run.check();
                result.getPixels(pixels, 0, width, 0, y, width, 1);
                for (int x = 0; x < width; x++) {
                    int pixel = pixels[x];
                    int value = (299 * Color.red(pixel) + 587 * Color.green(pixel) + 114 * Color.blue(pixel) + 500) / 1000;
                    if (binary) value = value < 120 ? 0 : 255;
                    pixels[x] = Color.rgb(value, value, value);
                }
                result.setPixels(pixels, 0, width, 0, y, width, 1);
            }
            return result;
        } catch (RuntimeException | OutOfMemoryError error) {
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

    private record Line(String text, Rect box, float confidence) {}
    private record Word(String text, Rect box, float confidence) {}

    private static List<Line> readLines(Run run, TessBaseAPI engine) {
        List<Line> lines = new ArrayList<>();
        ResultIterator iterator = engine.getResultIterator();
        if (iterator == null) return lines;
        try {
            List<Word> words = new ArrayList<>();
            String text = null;
            iterator.begin();
            do {
                run.check();
                if (iterator.isAtBeginningOf(RIL_TEXTLINE)) {
                    appendLine(lines, text, words);
                    words.clear();
                    text = iterator.getUTF8Text(RIL_TEXTLINE);
                }
                String word = iterator.getUTF8Text(RIL_WORD);
                if (word == null || word.trim().isEmpty()) continue;
                int[] bounds = iterator.getBoundingBox(RIL_WORD);
                if (bounds == null || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) continue;
                words.add(new Word(word.trim(), new Rect(bounds[0], bounds[1], bounds[2], bounds[3]),
                    iterator.confidence(RIL_WORD)));
            } while (iterator.next(RIL_WORD));
            appendLine(lines, text, words);
            return lines;
        } finally {
            iterator.delete();
        }
    }

    private static void appendLine(List<Line> lines, String text, List<Word> words) {
        if (words.isEmpty()) return;
        int[] heights = words.stream()
            .filter(word -> word.text().codePoints().anyMatch(Character::isLetterOrDigit))
            .mapToInt(word -> word.box().height()).sorted().toArray();
        int height = heights.length == 0 ? words.get(0).box().height() : heights[heights.length / 2];
        words.sort(Comparator.comparingInt(word -> word.box().left));
        int start = 0;
        for (int index = 1; index < words.size(); index++) {
            Rect previous = words.get(index - 1).box();
            Rect next = words.get(index).box();
            if (OcrImagePolicy.separateWords(previous.right, previous.centerY(), next.left, next.centerY(), height)) {
                lines.add(fragment(words.subList(start, index), null));
                start = index;
            }
        }
        lines.add(fragment(words.subList(start, words.size()), start == 0 ? text : null));
    }

    private static Line fragment(List<Word> words, String text) {
        Rect box = new Rect();
        StringBuilder joined = new StringBuilder();
        float confidence = 0;
        for (Word word : words) {
            box.union(word.box());
            if (joined.length() > 0) joined.append(' ');
            joined.append(word.text());
            confidence += word.confidence();
        }
        String value = text != null && !text.trim().isEmpty() ? text.trim() : joined.toString();
        return new Line(value, box, confidence / words.size());
    }

    private static JSObject document(List<Line> recognized, int width, int height) {
        JSArray lines = new JSArray();
        for (Line line : recognized) {
            Rect box = line.box();
            double[] bounds = OcrImagePolicy.box(box.left, box.top, box.right, box.bottom, width, height);
            if (bounds == null) continue;
            if (lines.length() == 10000 || line.text().length() > 10000) {
                throw new IllegalStateException("OCR output exceeds bridge limits");
            }
            JSObject item = new JSObject().put("id", "line-" + lines.length()).put("text", line.text())
                .put("box", new JSObject().put("x", bounds[0]).put("y", bounds[1])
                    .put("width", bounds[2]).put("height", bounds[3]));
            if (Float.isFinite(line.confidence())) {
                item.put("confidence", Math.max(0, Math.min(100, line.confidence())));
            }
            lines.put(item);
        }
        return new JSObject().put("image", new JSObject().put("width", width).put("height", height)).put("lines", lines);
    }

    @Override
    protected void handleOnDestroy() {
        Run run = active;
        if (run != null) run.cancel();
        active = null;
        picker = null;
    }
}
