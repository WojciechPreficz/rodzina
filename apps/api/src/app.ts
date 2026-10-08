import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './config.js';
import type { createDatabase } from './db/client.js';

type Database = ReturnType<typeof createDatabase>;

export async function buildApp(config: AppConfig, database: Database): Promise<FastifyInstance> {
  const app = Fastify({ trustProxy: true, logger: config.NODE_ENV !== 'test' });
  const version = process.env.npm_package_version ?? '0.1.0';

  app.get('/api/health', async (_request, reply) => {
    let dbOk = false;
    try {
      database.sqlite.prepare('SELECT 1').get();
      dbOk = true;
    } catch (error) {
      app.log.error({ err: error }, 'Health check failed to query SQLite');
    }

    return reply.code(dbOk ? 200 : 503).send({ ok: true, version, dbOk });
  });

  if (config.NODE_ENV === 'production') {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', config.RODZINA_WEB_DIR);
    await app.register(fastifyStatic, { root, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu.' },
        });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
