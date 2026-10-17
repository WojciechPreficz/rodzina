package pl.preficze.rodzina;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.function.BooleanSupplier;
import java.util.function.LongConsumer;
import java.util.function.LongSupplier;

/** Streaming verification is independent of Android and never accepts a partial APK. */
final class UpdateTransfer {
    static final long MAX_BYTES = 200L * 1024 * 1024;

    static void copy(InputStream input, OutputStream output, long total, String expectedHash,
                     BooleanSupplier cancelled, LongSupplier availableBytes, LongConsumer progress) throws Exception {
        if (total > MAX_BYTES) throw new IOException("Plik APK jest zbyt duży.");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long count = 0;
        byte[] buffer = new byte[65536];
        int read;
        while ((read = input.read(buffer)) != -1) {
            if (cancelled.getAsBoolean()) throw new IOException("Anulowano pobieranie.");
            count += read;
            if (count > MAX_BYTES || availableBytes.getAsLong() < read + 1024 * 1024) throw new IOException("Brak miejsca lub przekroczony limit APK.");
            output.write(buffer, 0, read);
            digest.update(buffer, 0, read);
            progress.accept(count);
        }
        if (cancelled.getAsBoolean()) throw new IOException("Anulowano pobieranie.");
        if (count == 0 || (total >= 0 && count != total) || !hex(digest.digest()).equalsIgnoreCase(expectedHash)) throw new IOException("Suma SHA-256 nie zgadza się. Pobierz aktualizację ponownie.");
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }
}
