import { getSessionGeneration, invalidateSessionRequests, isAndroid, nativeRequest } from './platform.js';
import { reportTransportFailure } from './connectivity.js';

export type ApiError = { error?: { code?: string; message?: string }; message?: string };

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly retryAfterMs = 0,
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
  const generation = getSessionGeneration();
  const headers = new Headers(init.headers ?? {});

  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const request = async () =>
    isAndroid()
      ? await nativeRequest(input, init)
      : await fetch(input, {
          credentials: 'include',
          ...init,
          headers,
        });
  let response;
  let text;
  try {
    response = await request();
    text = await response.text();
  } catch (error) {
    if (generation !== getSessionGeneration()) throw new DOMException('Session changed', 'AbortError');
    if (!(error instanceof Error && error.name === 'AbortError')) reportTransportFailure(true);
    throw error;
  }
  if (generation !== getSessionGeneration()) throw new DOMException('Session changed', 'AbortError');
  init.signal?.throwIfAborted();

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
    const retryAfter = response.headers?.get('Retry-After');
    const retryAfterMs = retryAfter
      ? Math.max(0, /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now())
      : 0;
    throw new ApiRequestError(
      message,
      response.status,
      (payload as ApiError)?.error?.code,
      Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
    );
  }

  return (payload ?? {}) as T;
}
