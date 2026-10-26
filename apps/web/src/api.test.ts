import { afterEach, expect, it, vi } from 'vitest';
import { apiFetch } from './api.js';

afterEach(() => vi.unstubAllGlobals());
it.each([
  ['60', 60000],
  [new Date(100000).toUTCString(), 99000],
  ['invalid', 0],
])('preserves API error codes and Retry-After %s', async (header, delay) => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: 'RATE_LIMIT', message: 'Spróbuj później.' } }), {
          status: 429,
          headers: { 'Retry-After': header },
        }),
    ),
  );
  try {
    await expect(apiFetch('/api/shopping/lists')).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMIT',
      retryAfterMs: delay,
    });
  } finally {
    clock.mockRestore();
  }
});
