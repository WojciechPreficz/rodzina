// @vitest-environment node
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiError, registerApiErrorHandler } from './errors.js';
import { parse } from './validation.js';

describe('global API errors', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createApp() {
    const app = Fastify();
    apps.push(app);
    registerApiErrorHandler(app);
    return app;
  }

  it.each([400, 401, 403, 404, 409, 413, 415, 422, 429])(
    'preserves HTTP status %s without leaking details',
    async (statusCode) => {
      const app = createApp();
      app.get('/error', () => {
        throw Object.assign(new Error('Private error details'), { statusCode });
      });
      const response = await app.inject('/error');
      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toEqual({ error: { code: expect.any(String), message: expect.any(String) } });
      expect(response.body).not.toContain('Private error details');
    },
  );

  it.each([
    new Error('secret'),
    Object.assign(new Error('secret'), { statusCode: 503 }),
    new z.ZodError([{ code: 'custom', path: [], message: 'secret' }]),
  ])('hides unexpected and response validation errors', async (error) => {
    const app = createApp();
    app.get('/error', () => {
      throw error;
    });
    const response = await app.inject('/error');
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Nie udało się obsłużyć żądania.' } });
  });

  it('preserves domain errors', async () => {
    const app = createApp();
    app.get('/error', () => {
      throw new ApiError(410, 'EXPIRED', 'Zaproszenie wygasło.');
    });
    const response = await app.inject('/error');
    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({ error: { code: 'EXPIRED', message: 'Zaproszenie wygasło.' } });
  });

  it.each([undefined, 'Identyfikator zmiany jest już używany.'])(
    'limits primary key conflict translation to configured routes (%s)',
    async (message) => {
      const app = createApp();
      app.get('/error', { config: message ? { primaryKeyConflictMessage: message } : {} }, () => {
        throw Object.assign(new Error('secret'), { code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
      });
      const response = await app.inject('/error');
      expect(response.statusCode).toBe(message ? 409 : 500);
      expect(response.json().error.code).toBe(message ? 'OPERATION_CONFLICT' : 'INTERNAL_ERROR');
    },
  );

  it('validates and transforms request input through the shared parser', async () => {
    const app = createApp();
    app.post('/input', (request) => parse(z.object({ name: z.string().trim().min(2) }), request.body));
    expect(
      (await app.inject({ method: 'POST', url: '/input', payload: { name: '  Anna  ', extra: true } })).json(),
    ).toEqual({ name: 'Anna' });
    const response = await app.inject({ method: 'POST', url: '/input', payload: { name: ' ' } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });
});
