export type ApiError = { error?: { code?: string; message?: string }; message?: string };

export function sanitizeNextPath(rawPath: string | null | undefined): string {
  if (!rawPath) {
    return '/';
  }

  const candidate = rawPath.trim();
  if (!candidate.startsWith('/')) {
    return '/';
  }

  if (candidate.startsWith('//') || candidate.startsWith('\\\\')) {
    return '/';
  }

  return candidate;
}

export async function apiFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});

  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    credentials: 'include',
    ...init,
    headers,
  });

  const text = await response.text();
  let payload: ApiError | Record<string, unknown> | null = null;

  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } } | undefined)?.error?.message ??
      (payload as { message?: string } | undefined)?.message ??
      'Wystąpił błąd żądania.';
    throw new Error(message);
  }

  return (payload ?? {}) as T;
}
