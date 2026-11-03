package pl.preficze.rodzina;

/** Pure size policy shared by decoding and JVM tests. */
final class OcrImagePolicy {
    static final int MAX_BYTES = 20 * 1024 * 1024;
    static final int MAX_SIDE = 3200;

    static int sampleSize(int width, int height) {
        if (width <= 0 || height <= 0) throw new IllegalArgumentException("Invalid image dimensions");
        int sample = 1;
        while ((long) Math.ceil(width / (double) sample) * Math.ceil(height / (double) sample) > 12_000_000L
                || Math.max(width, height) / (double) sample > MAX_SIDE * 2) sample *= 2;
        return sample;
    }

    static int[] size(int width, int height, int limit) {
        if (width <= 0 || height <= 0 || limit <= 0) throw new IllegalArgumentException("Invalid image dimensions");
        double scale = Math.min(1, limit / (double) Math.max(width, height));
        return new int[] { Math.max(1, (int) Math.round(width * scale)), Math.max(1, (int) Math.round(height * scale)) };
    }

    static boolean supported(String mime) {
        return "image/jpeg".equals(mime) || "image/png".equals(mime) || "image/webp".equals(mime);
    }

    static int[] contrastSize(int width, int height) {
        double scale = Math.min(2, MAX_SIDE / (double) Math.max(width, height));
        return new int[] {Math.max(1, (int) Math.round(width * scale)), Math.max(1, (int) Math.round(height * scale))};
    }

    static boolean separateWords(int previousRight, int previousCenterY, int left, int centerY, int height) {
        return left - previousRight > height * 3 || Math.abs(centerY - previousCenterY) > height * 0.8;
    }

    static boolean refineLine(String text, float confidence) {
        return text.matches(".*[0-9]{4}.*")
            || ((confidence <= 0 || confidence < 0.8f || text.contains("|"))
                && text.codePoints().filter(Character::isLetter).count() >= 3);
    }

    static double[] box(int left, int top, int right, int bottom, int width, int height) {
        double x = Math.max(0, Math.min(1, left / (double) width));
        double y = Math.max(0, Math.min(1, top / (double) height));
        double w = Math.min(1, right / (double) width) - x;
        double h = Math.min(1, bottom / (double) height) - y;
        return w > 0 && h > 0 ? new double[] {x, y, w, h} : null;
    }
}
