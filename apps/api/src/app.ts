import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type onRouteHookHandler } from 'fastify';
import { z } from 'zod';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './config.js';
import type { DatabaseConnection } from './db/client.js';
import { registerApiErrorHandler, sendError } from './http/errors.js';
import { registerIdempotency } from './http/idempotency.js';
import { routeOptions } from './http/route-contract.js';
import { registerSecurityHeaders } from './http/security-headers.js';
import { registerSessionAuth } from './http/session-auth.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerFamilyRoutes } from './modules/family/routes.js';
import { registerEventRoutes } from './modules/events/routes.js';
import { registerReminderRoutes } from './modules/reminders/routes.js';
import { registerShoppingRoutes } from './modules/shopping/routes.js';
import { registerTaskListRoutes } from './modules/tasks/routes.js';
import { registerDocumentRoutes } from './modules/documents/routes.js';
import { registerContactRoutes } from './modules/contacts/routes.js';
import { registerMealRoutes } from './modules/meals/routes.js';
import { registerAndroidDownloads } from './android-downloads.js';
import type { sendResetMail } from './modules/auth/reset-mail.js';
import type { sendRegistrationMail } from './modules/auth/registration-mail.js';
import type { sendInvitationMail } from './modules/family/invitation-mail.js';

export const { version: apiVersion } = JSON.parse(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
) as {
  version: string;
};

export async function buildApp(
  config: AppConfig,
  database: DatabaseConnection,
  mailSender?: typeof sendResetMail,
  registrationMailSender?: typeof sendRegistrationMail,
  observeRoute?: onRouteHookHandler,
  invitationMailSender?: typeof sendInvitationMail,
): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.RODZINA_TRUSTED_PROXIES.length ? config.RODZINA_TRUSTED_PROXIES : false,
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'],
            serializers: { req: (request) => ({ method: request.method, hostname: request.hostname }) },
          },
  });

  registerApiErrorHandler(app);
  registerSecurityHeaders(app, config);
  const registerProfiles = registerIdempotency(app, database);
  if (observeRoute) app.addHook('onRoute', observeRoute);

  await app.register(fastifyRateLimit, {
    global: false,
    max: config.RODZINA_API_RATE_LIMIT_MAX,
    timeWindow: config.RODZINA_API_RATE_LIMIT_WINDOW_MS,
    ipv6Subnet: 128,
  });
  const limitApiRequest = app.rateLimit();
  app.addHook('onRequest', async (request, reply) => {
    const route = request.routeOptions.url;
    let pathname = request.url.split('?', 1)[0]!;
    if (pathname.includes('%')) {
      try {
        pathname = decodeURIComponent(pathname);
      } catch {
        // Keep the raw path for malformed requests.
      }
    }
    if (route === '/api' || route?.startsWith('/api/') || pathname === '/api' || pathname.startsWith('/api/')) {
      await limitApiRequest.call(app, request, reply);
    }
  });

  await app.register(fastifyCookie);

  registerSessionAuth(app, database, config);
  registerAuthRoutes(app, database, config, mailSender, registrationMailSender);
  registerFamilyRoutes(app, database, config, invitationMailSender);

  const healthResponse = <Ready extends boolean>(ready: Ready) =>
    z.object({ ok: z.literal(ready), version: z.string(), dbOk: z.literal(ready) });
  app.get(
    '/api/health',
    routeOptions({ responses: { 200: healthResponse(true), 503: healthResponse(false) } }, { auth: 'public' }),
    async (_request, reply) => {
      let dbOk = false;
      try {
        database.sqlite.prepare('SELECT 1').get();
        dbOk = true;
      } catch (error) {
        app.log.error({ err: error }, 'Health check failed to query SQLite');
      }

      return reply.code(dbOk ? 200 : 503).send({ ok: dbOk, version: apiVersion, dbOk });
    },
  );

  registerEventRoutes(app, database);
  registerShoppingRoutes(app, database, registerProfiles);
  registerTaskListRoutes(app, database, registerProfiles);
  registerDocumentRoutes(app, database);
  registerContactRoutes(app, database);
  registerMealRoutes(app, database, registerProfiles);
  registerAndroidDownloads(app, config);
  app.get('/.well-known/assetlinks.json', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    return config.RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS.length
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: 'pl.preficze.rodzina',
              sha256_cert_fingerprints: config.RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS,
            },
          },
        ]
      : [];
  });
  registerReminderRoutes(app, database);

  if (config.NODE_ENV === 'production') {
    // Overlay deployments may leave the historical manifest on disk.
    app.get('/manifest.webmanifest', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return reply.code(410).send({ error: { code: 'NOT_FOUND', message: 'Wersja PWA została wycofana.' } });
    });
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', config.RODZINA_WEB_DIR);
    await app.register(fastifyStatic, { root, prefix: '/' });
    app.get('/strona', async (request, reply) => {
      const search = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
      return reply.redirect(`/strona/${search}`);
    });
    app.get('/strona/', async (_request, reply) => reply.sendFile('strona/index.html'));
    app.setNotFoundHandler((request, reply) => {
      // Match the router's decoded path before considering the SPA fallback.
      let pathname: string;
      try {
        pathname = decodeURIComponent(request.url.split('?')[0]!);
      } catch {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Niepoprawna ścieżka żądania.' } });
      }
      if (
        pathname === '/api' ||
        pathname.startsWith('/api/') ||
        pathname.startsWith('/downloads/') ||
        pathname.startsWith('/strona/') ||
        pathname.startsWith('/ocr/')
      ) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu.' },
        });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_request, reply) => sendError(reply, 404, 'NOT_FOUND', 'Nie znaleziono zasobu.'));
  }

  return app;
}
