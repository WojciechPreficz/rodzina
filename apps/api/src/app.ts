import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './config.js';
import type { DatabaseConnection } from './db/client.js';
import { registerApiErrorHandler, sendError } from './http/errors.js';
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
import { registerAndroidDownloads } from './android-downloads.js';

const { version } = JSON.parse(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
) as {
  version: string;
};

export async function buildApp(config: AppConfig, database: DatabaseConnection): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: true,
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

  await app.register(fastifyCookie);

  registerSessionAuth(app, database, config);
  registerAuthRoutes(app, database, config);
  registerFamilyRoutes(app, database, config);

  app.get('/api/health', { config: { auth: 'public' } }, async (_request, reply) => {
    let dbOk = false;
    try {
      database.sqlite.prepare('SELECT 1').get();
      dbOk = true;
    } catch (error) {
      app.log.error({ err: error }, 'Health check failed to query SQLite');
    }

    return reply.code(dbOk ? 200 : 503).send({ ok: dbOk, version, dbOk });
  });

  registerEventRoutes(app, database);
  registerShoppingRoutes(app, database);
  registerTaskListRoutes(app, database);
  registerDocumentRoutes(app, database);
  registerContactRoutes(app, database);
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
    app.setNotFoundHandler((request, reply) => {
      // Match the router's decoded path before considering the SPA fallback.
      let pathname: string;
      try {
        pathname = decodeURIComponent(request.url.split('?')[0]!);
      } catch {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Niepoprawna ścieżka żądania.' } });
      }
      if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/downloads/')) {
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
