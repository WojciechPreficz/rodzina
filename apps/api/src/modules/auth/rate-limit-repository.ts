import { eq, lte } from 'drizzle-orm';
import type { DatabaseConnection } from '../../db/client.js';
import { authRateLimits } from '../../db/schema.js';

export function createAuthRateLimitRepository(database: DatabaseConnection) {
  const find = (scopeKey: string) =>
    database.db.select().from(authRateLimits).where(eq(authRateLimits.scopeKey, scopeKey)).get();
  const reserve = database.sqlite.transaction((scopeKey: string, now: number, limit: number, windowMs: number) => {
    const existing = find(scopeKey);
    const active = existing && existing.expiresAt > now;
    if (active && existing.count >= limit) return undefined;

    const values = {
      scopeKey,
      count: active ? existing.count + 1 : 1,
      expiresAt: active ? existing.expiresAt : now + windowMs,
    };
    database.db
      .insert(authRateLimits)
      .values(values)
      .onConflictDoUpdate({ target: authRateLimits.scopeKey, set: values })
      .run();
    return values.expiresAt;
  });

  function retryAfter(scopeKey: string, now: number, limit: number) {
    const row = find(scopeKey);
    return row && row.count >= limit && row.expiresAt > now ? Math.ceil((row.expiresAt - now) / 1000) : 0;
  }
  const deleteExpired = (now: number) =>
    database.db.delete(authRateLimits).where(lte(authRateLimits.expiresAt, now)).run().changes;

  return {
    consumeAll(limits: readonly { key: string; max: number; windowMs: number }[], now: number) {
      return database.sqlite
        .transaction(() => {
          deleteExpired(now);
          const blocked = Math.max(0, ...limits.map(({ key, max }) => retryAfter(key, now, max)));
          if (blocked) return blocked;
          for (const { key, max, windowMs } of limits) reserve(key, now, max, windowMs);
          return 0;
        })
        .immediate();
    },
    consume(scopeKey: string, now: number, limit: number, windowMs: number) {
      // Reserve the attempt before asynchronous credential verification, across all connections.
      return reserve.immediate(scopeKey, now, limit, windowMs) !== undefined;
    },
    reserve: reserve.immediate,
    retryAfter,
    release(scopeKey: string, expiresAt: number) {
      database.sqlite
        .transaction(() => {
          const row = find(scopeKey);
          if (!row || row.expiresAt !== expiresAt) return;
          const key = eq(authRateLimits.scopeKey, scopeKey);
          if (row.count === 1) database.db.delete(authRateLimits).where(key).run();
          else
            database.db
              .update(authRateLimits)
              .set({ count: row.count - 1 })
              .where(key)
              .run();
        })
        .immediate();
    },
    clear(scopeKey: string) {
      database.db.delete(authRateLimits).where(eq(authRateLimits.scopeKey, scopeKey)).run();
    },
    deleteExpired,
  };
}
