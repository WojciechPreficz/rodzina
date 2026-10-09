import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, gt } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import {
  generateJoinCode,
  getOriginHost,
  hashPassword,
  hashToken,
  isJsonMutation,
  isValidPassword,
  normalizeEmail,
  randomToken,
  SESSION_TTL_MS,
  verifyPassword,
} from './auth.js';
import type { AppConfig } from './config.js';
import type { createDatabase } from './db/client.js';
import * as schema from './db/schema.js';

type Database = ReturnType<typeof createDatabase>;

type PublicAuthUser = {
  id: string;
  familyId: string;
  displayName: string;
  email: string | null;
  role: 'admin' | 'member' | 'child';
  color: string;
  createdAt: number;
  updatedAt: number;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicAuthUser;
    familyId?: string;
  }
}

const registerFamilySchema = z.object({
  familyName: z.string().trim().min(2),
  displayName: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function serializeUser(user: {
  id: string;
  family_id?: string;
  familyId?: string;
  display_name?: string;
  displayName?: string;
  email: string | null;
  role: 'admin' | 'member' | 'child';
  color: string;
  created_at?: number;
  createdAt?: number;
  updated_at?: number;
  updatedAt?: number;
}): PublicAuthUser {
  return {
    id: user.id,
    familyId: user.familyId ?? user.family_id ?? '',
    displayName: user.displayName ?? user.display_name ?? '',
    email: user.email,
    role: user.role,
    color: user.color,
    createdAt: user.createdAt ?? user.created_at ?? Date.now(),
    updatedAt: user.updatedAt ?? user.updated_at ?? Date.now(),
  };
}

function isPublicApiRequest(method: string, url: string): boolean {
  if (url === '/api/health') {
    return true;
  }

  if (method === 'POST' && url === '/api/auth/register-family') {
    return true;
  }

  if (method === 'POST' && url === '/api/auth/login') {
    return true;
  }

  if (method === 'POST' && url === '/api/auth/login-child') {
    return true;
  }

  if (method === 'GET' && url === '/api/auth/family-members') {
    return true;
  }

  if ((method === 'GET' || method === 'POST') && url.startsWith('/api/invitations/')) {
    return true;
  }

  if (method === 'POST' && url === '/api/auth/reset-password') {
    return true;
  }

  return false;
}

function getLoginRateLimitKey(ip: string, email: string): string {
  return `${ip}:${email}`;
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const existing = loginAttempts.get(key);

  if (!existing) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }

  if (existing.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }

  if (existing.count >= 9) {
    return false;
  }

  existing.count += 1;
  loginAttempts.set(key, existing);
  return true;
}

function clearLoginRateLimit(key: string): void {
  loginAttempts.delete(key);
}

function sendError(reply: any, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export async function buildApp(config: AppConfig, database: Database): Promise<FastifyInstance> {
  const app = Fastify({ trustProxy: true, logger: config.NODE_ENV !== 'test' });
  const version = process.env.npm_package_version ?? '0.1.0';

  await app.register(fastifyCookie);

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }

    if (isJsonMutation(request.method) && request.headers.origin) {
      const originHost = getOriginHost(request.headers.origin);
      const requestHost = request.headers['x-forwarded-host'] ?? request.headers.host;

      if (!requestHost || !originHost || originHost !== requestHost) {
        return sendError(reply, 403, 'FORBIDDEN', 'Żądanie pochodzi z niezweryfikowanego źródła.');
      }
    }

    if (isPublicApiRequest(request.method, request.url)) {
      return;
    }

    const rawSession = request.cookies?.sid;
    if (!rawSession) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    const sessionHash = hashToken(rawSession);
    const sessionRecord = database.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionHash), gt(schema.sessions.expiresAt, Date.now())))
      .get();

    if (!sessionRecord) {
      reply.clearCookie('sid', { path: '/' });
      return sendError(reply, 401, 'UNAUTHORIZED', 'Sesja wygasła lub jest nieprawidłowa.');
    }

    const userRecord = database.db.select().from(schema.users).where(eq(schema.users.id, sessionRecord.userId)).get();

    if (!userRecord) {
      reply.clearCookie('sid', { path: '/' });
      return sendError(reply, 401, 'UNAUTHORIZED', 'Użytkownik sesji nie istnieje.');
    }

    const nextExpiry = Date.now() + SESSION_TTL_MS;
    database.db.update(schema.sessions).set({ expiresAt: nextExpiry }).where(eq(schema.sessions.id, sessionHash)).run();

    request.user = serializeUser(userRecord);
    request.familyId = userRecord.family_id;
  });

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

  app.post('/api/auth/register-family', async (request, reply) => {
    const parsed = registerFamilySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Dane rejestracji są niepoprawne.');
    }

    if (!config.RODZINA_ALLOW_REGISTRATION) {
      return sendError(reply, 403, 'FORBIDDEN', 'Rejestracja rodziny jest wyłączona.');
    }

    const { familyName, displayName, email, password } = parsed.data;
    const normalizedEmail = normalizeEmail(email);
    const existingUser = database.db.select().from(schema.users).where(eq(schema.users.email, normalizedEmail)).get();

    if (existingUser) {
      return sendError(reply, 409, 'CONFLICT', 'Użytkownik z tym adresem e-mail już istnieje.');
    }

    if (!isValidPassword(password)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Hasło musi mieć co najmniej 8 znaków.');
    }

    const familyId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const now = Date.now();
    const passwordHash = await hashPassword(password);
    let joinCode = generateJoinCode();

    while (database.db.select().from(schema.families).where(eq(schema.families.joinCode, joinCode)).get()) {
      joinCode = generateJoinCode();
    }

    database.db
      .insert(schema.families)
      .values({
        id: familyId,
        name: familyName,
        timezone: 'Europe/Warsaw',
        joinCode,
        createdAt: now,
      })
      .run();

    database.db
      .insert(schema.users)
      .values({
        id: userId,
        familyId,
        displayName,
        email: normalizedEmail,
        passwordHash,
        role: 'admin',
        color: '#5C7CFA',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const sessionToken = randomToken();
    const sessionHash = hashToken(sessionToken);

    database.db
      .insert(schema.sessions)
      .values({
        id: sessionHash,
        userId,
        expiresAt: now + SESSION_TTL_MS,
        createdAt: now,
        userAgent: request.headers['user-agent'] ?? null,
      })
      .run();

    const family = database.db.select().from(schema.families).where(eq(schema.families.id, familyId)).get();
    const user = database.db.select().from(schema.users).where(eq(schema.users.id, userId)).get();

    reply.setCookie('sid', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 60,
    });

    return reply.code(201).send({
      ok: true,
      family: {
        id: family.id,
        name: family.name,
        timezone: family.timezone,
        joinCode: family.joinCode,
      },
      user: serializeUser(user),
    });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Dane logowania są niepoprawne.');
    }

    const { email, password } = parsed.data;
    const normalizedEmail = normalizeEmail(email);
    const loginKey = getLoginRateLimitKey(request.ip ?? 'unknown', normalizedEmail);

    if (!checkRateLimit(loginKey)) {
      return sendError(reply, 429, 'RATE_LIMITED', 'Za dużo prób logowania. Spróbuj ponownie później.');
    }

    const user = database.db.select().from(schema.users).where(eq(schema.users.email, normalizedEmail)).get();
    if (!user || !user.passwordHash) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Nieprawidłowy e-mail lub hasło.');
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Nieprawidłowy e-mail lub hasło.');
    }

    clearLoginRateLimit(loginKey);

    const now = Date.now();
    const sessionToken = randomToken();
    const sessionHash = hashToken(sessionToken);

    database.db
      .insert(schema.sessions)
      .values({
        id: sessionHash,
        userId: user.id,
        expiresAt: now + SESSION_TTL_MS,
        createdAt: now,
        userAgent: request.headers['user-agent'] ?? null,
      })
      .run();

    reply.setCookie('sid', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 60,
    });

    const family = database.db.select().from(schema.families).where(eq(schema.families.id, user.family_id)).get();

    return {
      ok: true,
      user: serializeUser(user),
      family: family ? { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode } : null,
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionToken = request.cookies?.sid;
    if (sessionToken) {
      database.db.delete(schema.sessions).where(eq(schema.sessions.id, hashToken(sessionToken))).run();
    }

    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    const family = database.db.select().from(schema.families).where(eq(schema.families.id, request.user.familyId)).get();
    return {
      ok: true,
      user: request.user,
      family: family ? { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode } : null,
    };
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
