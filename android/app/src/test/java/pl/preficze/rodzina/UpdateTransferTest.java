package pl.preficze.rodzina;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

public class UpdateTransferTest {
    private final byte[] apk = "a verified APK payload".getBytes(StandardCharsets.UTF_8);
    private String hash() throws Exception { return UpdateTransfer.hex(MessageDigest.getInstance("SHA-256").digest(apk)); }

    @Test public void copiesAndVerifiesWithKnownOrUnknownLength() throws Exception {
        for (long size : new long[] { apk.length, -1 }) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            UpdateTransfer.copy(new ByteArrayInputStream(apk), output, size, hash(), () -> false, () -> Long.MAX_VALUE, count -> {});
            assertArrayEquals(apk, output.toByteArray());
        }
    }
    @Test public void rejectsCorruptionAndTruncatedTransfers() throws Exception {
        String hash = hash();
        assertThrows(IOException.class, () -> UpdateTransfer.copy(new ByteArrayInputStream("corrupt".getBytes()), new ByteArrayOutputStream(), -1, hash, () -> false, () -> Long.MAX_VALUE, count -> {}));
        assertThrows(IOException.class, () -> UpdateTransfer.copy(new ByteArrayInputStream(apk), new ByteArrayOutputStream(), apk.length + 1, hash, () -> false, () -> Long.MAX_VALUE, count -> {}));
        assertThrows(IOException.class, () -> UpdateTransfer.copy(new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), -1, hash, () -> false, () -> Long.MAX_VALUE, count -> {}));
    }
    @Test public void rejectsCancellationLackOfSpaceAndOversizeBeforeAcceptingFile() throws Exception {
        String hash = hash();
        assertThrows(IOException.class, () -> UpdateTransfer.copy(new ByteArrayInputStream(apk), new ByteArrayOutputStream(), apk.length, hash, () -> true, () -> Long.MAX_VALUE, count -> {}));
        assertThrows(IOException.class, () -> UpdateTransfer.copy(new ByteArrayInputStream(apk), new ByteArrayOutputStream(), apk.length, hash, () -> false, () -> 0, count -> {}));
        assertThrows(IOException.class, () -> UpdateTransfer.copy(new ByteArrayInputStream(apk), new ByteArrayOutputStream(), UpdateTransfer.MAX_BYTES + 1, hash, () -> false, () -> Long.MAX_VALUE, count -> {}));
    }
}
