import { invalidateSessionRequests, isAndroid, nativeRequest } from './platform.js';

export type ApiError = { error?: { code?: string; message?: string }; message?: string };

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function sanitizeNextPath(rawPath: string | null | undefined): string {
  if (!rawPath) {
    return '/';
  }

  const candidate = rawPath.trim();
  const unsafe = (value: string) =>
    [...value].some((char) => char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if (!candidate.startsWith('/')) {
    return '/';
  }

  if (candidate.startsWith('//') || /\s/.test(candidate) || unsafe(candidate)) {
    return '/';
  }
  try {
    const decoded = decodeURIComponent(candidate);
    if (decoded.startsWith('//') || unsafe(decoded)) return '/';
    const url = new URL(candidate, 'https://localhost');
    return url.origin === 'https://localhost' ? url.pathname + url.search + url.hash : '/';
  } catch {
    return '/';
  }
}

export async function apiFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});

  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = isAndroid()
    ? await nativeRequest(input, init)
    : await fetch(input, {
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
    if (response.status === 401) {
      invalidateSessionRequests();
      window.dispatchEvent(new Event('rodzina:session-lost'));
    }
    const message =
      (payload as { error?: { message?: string } } | undefined)?.error?.message ??
      (payload as { message?: string } | undefined)?.message ??
      'Wystąpił błąd żądania.';
    throw new ApiRequestError(message, response.status);
  }

  return (payload ?? {}) as T;
}
