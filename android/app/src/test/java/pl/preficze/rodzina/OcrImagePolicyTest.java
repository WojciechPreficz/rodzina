package pl.preficze.rodzina;

import org.junit.Test;
import static org.junit.Assert.*;

public class OcrImagePolicyTest {
    @Test public void boundsDecodedMemoryBeforeResizing() {
        for (int[] size : new int[][] {{ 100000, 100000 }, { 30000, 100 }, { 12000, 9000 }, { 4032, 3024 }}) {
            int sample = OcrImagePolicy.sampleSize(size[0], size[1]);
            assertTrue(Math.ceil(size[0] / (double) sample) * Math.ceil(size[1] / (double) sample) <= 12_000_000);
            assertTrue(Math.max(size[0], size[1]) / (double) sample <= 6400);
        }
    }
    @Test public void preservesAspectAndNeverUpscales() {
        assertArrayEquals(new int[] {3200, 2400}, OcrImagePolicy.size(8000, 6000, 3200));
        assertArrayEquals(new int[] {480, 640}, OcrImagePolicy.size(2400, 3200, 640));
        assertArrayEquals(new int[] {100, 200}, OcrImagePolicy.size(100, 200, 3200));
        assertArrayEquals(new int[] {1, 3200}, OcrImagePolicy.size(1, 100000, 3200));
    }
    @Test(expected = IllegalArgumentException.class) public void rejectsBrokenBounds() { OcrImagePolicy.sampleSize(-1, 500); }
    @Test public void normalizesLinesAgainstOrientedImageAndClipsEdges() {
        assertArrayEquals(new double[] {0.1, 0.2, 0.5, 0.1}, OcrImagePolicy.box(10, 40, 60, 60, 100, 200), 0.000001);
        assertArrayEquals(new double[] {0, 0, 1, 1}, OcrImagePolicy.box(-10, -20, 110, 220, 100, 200), 0.000001);
        assertNull(OcrImagePolicy.box(200, 0, 250, 50, 100, 200));
        assertNull(OcrImagePolicy.box(10, 40, 10, 60, 100, 200));
    }
    @Test public void contrastResizingStaysBoundedAndSplitsDistantWords() {
        assertArrayEquals(new int[] {3200, 2264}, OcrImagePolicy.contrastSize(2000, 1415));
        assertArrayEquals(new int[] {200, 400}, OcrImagePolicy.contrastSize(100, 200));
        assertArrayEquals(new int[] {2400, 3200}, OcrImagePolicy.contrastSize(2400, 3200));
        assertTrue(OcrImagePolicy.separateWords(300, 400, 620, 410, 40));
        assertTrue(OcrImagePolicy.separateWords(300, 400, 310, 450, 40));
        assertFalse(OcrImagePolicy.separateWords(300, 400, 310, 405, 40));
    }
    @Test public void onlyAcceptsSupportedFormats() {
        assertTrue(OcrImagePolicy.supported("image/jpeg"));
        assertTrue(OcrImagePolicy.supported("image/png"));
        assertTrue(OcrImagePolicy.supported("image/webp"));
        assertFalse(OcrImagePolicy.supported("image/heic"));
        assertFalse(OcrImagePolicy.supported(null));
        assertEquals(20971520, OcrImagePolicy.MAX_BYTES);
    }
    @Test public void refinesDatesAndUncertainWordsWithoutRetryingDecorations() {
        assertTrue(OcrImagePolicy.refineLine("S.11.2026 R.", 0.95f));
        assertTrue(OcrImagePolicy.refineLine("5.11.2026 R.", 0.95f));
        assertTrue(OcrImagePolicy.refineLine("ANDRZE-KI", 0.3f));
        assertTrue(OcrImagePolicy.refineLine("KACPER | EMMA", 0.96f));
        assertFalse(OcrImagePolicy.refineLine("DOGOTERAPIA", 0.95f));
        assertFalse(OcrImagePolicy.refineLine("=>", 0.2f));
    }
}
