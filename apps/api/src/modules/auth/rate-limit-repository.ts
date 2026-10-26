import { eq, lte } from 'drizzle-orm';
import type { DatabaseConnection } from '../../db/client.js';
import { authRateLimits } from '../../db/schema.js';

export function createAuthRateLimitRepository(database: DatabaseConnection) {
  const consume = database.sqlite.transaction((scopeKey: string, now: number, limit: number, windowMs: number) => {
    const existing = database.db.select().from(authRateLimits).where(eq(authRateLimits.scopeKey, scopeKey)).get();
    const active = existing && existing.expiresAt > now;
    if (active && existing.count >= limit) return false;

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
    return true;
  });

  return {
    consume(scopeKey: string, now: number, limit: number, windowMs: number) {
      // Reserve the attempt before asynchronous credential verification, across all connections.
      return consume.immediate(scopeKey, now, limit, windowMs);
    },
    clear(scopeKey: string) {
      database.db.delete(authRateLimits).where(eq(authRateLimits.scopeKey, scopeKey)).run();
    },
    deleteExpired(now: number) {
      return database.db.delete(authRateLimits).where(lte(authRateLimits.expiresAt, now)).run().changes;
    },
  };
}
