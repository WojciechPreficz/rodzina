import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  pushSubscriptionSchema,
  deletePushSubscriptionSchema,
  pushPublicKeyResponseSchema,
  pushMutationResponseSchema,
  pushTestResponseSchema,
} from '@rodzina/shared';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { pushSubscriptions } from '../../db/schema.js';
import type { PushSender } from './sender.js';

export function registerPushRoutes(
  app: FastifyInstance,
  database: DatabaseConnection,
  config: AppConfig,
  sender: PushSender,
) {
  app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      if (
        error instanceof Error &&
        'statusCode' in error &&
        typeof error.statusCode === 'number' &&
        error.statusCode < 500
      )
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Dane żądania są niepoprawne.' } });
      // Do not log provider errors, subscription endpoints or encryption keys.
      routes.log.error('Push request failed');
      return reply
        .code(500)
        .send({ error: { code: 'INTERNAL_ERROR', message: 'Nie udało się obsłużyć powiadomień.' } });
    });
    routes.get('/api/push/public-key', async () =>
      pushPublicKeyResponseSchema.parse({ ok: true, publicKey: config.RODZINA_VAPID_PUBLIC_KEY }),
    );

    routes.post('/api/push/subscriptions', async (request, reply) => {
      const parsed = pushSubscriptionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'Subskrypcja powiadomień jest niepoprawna.' } });
      const { endpoint, keys } = parsed.data;
      const saved = database.db
        .insert(pushSubscriptions)
        .values({
          id: randomUUID(),
          userId: request.user!.id,
          endpoint,
          ...keys,
          userAgent: request.headers['user-agent'] ?? null,
          createdAt: Date.now(),
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { ...keys, userAgent: request.headers['user-agent'] ?? null, lastSuccessAt: null },
          setWhere: eq(pushSubscriptions.userId, request.user!.id),
        })
        .run();
      if (!saved.changes)
        return reply
          .code(409)
          .send({ error: { code: 'CONFLICT', message: 'Ta subskrypcja jest przypisana do innego domownika.' } });
      return pushMutationResponseSchema.parse({ ok: true });
    });
    routes.delete('/api/push/subscriptions', async (request, reply) => {
      const parsed = deletePushSubscriptionSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: { code: 'VALIDATION_ERROR', message: 'Adres subskrypcji jest niepoprawny.' } });
      database.db
        .delete(pushSubscriptions)
        .where(
          and(eq(pushSubscriptions.userId, request.user!.id), eq(pushSubscriptions.endpoint, parsed.data.endpoint)),
        )
        .run();
      return pushMutationResponseSchema.parse({ ok: true });
    });
    routes.post('/api/push/test', async (request) => {
      const subscriptions = database.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, request.user!.id))
        .all();
      const result = { ok: true as const, sent: 0, failed: 0, removed: 0 };
      for (const subscription of subscriptions) {
        const unchanged = and(
          eq(pushSubscriptions.id, subscription.id),
          eq(pushSubscriptions.userId, request.user!.id),
          eq(pushSubscriptions.p256dh, subscription.p256dh),
          eq(pushSubscriptions.auth, subscription.auth),
        );
        if (!database.db.select().from(pushSubscriptions).where(unchanged).get()) continue;
        try {
          await sender.send(subscription, {
            title: 'Rodzina — powiadomienie testowe',
            body: 'Powiadomienia na tym urządzeniu działają.',
            tag: 'rodzina-push-test',
            url: '/kalendarz',
          });
          database.db.update(pushSubscriptions).set({ lastSuccessAt: Date.now() }).where(unchanged).run();
          result.sent++;
        } catch (error) {
          const status =
            typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : undefined;
          if (status === 404 || status === 410)
            result.removed += database.db.delete(pushSubscriptions).where(unchanged).run().changes;
          else result.failed++;
        }
      }
      return pushTestResponseSchema.parse(result);
    });
  });
}
