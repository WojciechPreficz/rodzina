import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import {
  generateJoinCode,
  getOriginHost,
  hashPassword,
  hashPin,
  hashToken,
  isJsonMutation,
  isValidPassword,
  isValidPin,
  normalizeEmail,
  randomToken,
  SESSION_TTL_MS,
  verifyPassword,
  verifyPin,
} from './auth.js';
import { canEditMemberProfile, canManageFamilyMembers, canSetChildPin, canUpdateMemberRole } from './permissions.js';
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

  if (method === 'GET' && url.startsWith('/api/auth/family-members')) {
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

function findFamilyMember(
  database: Database,
  familyId: string,
  userId: string,
): typeof schema.users.$inferSelect | undefined {
  return database.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), eq(schema.users.familyId, familyId)))
    .get();
}

function countAdmins(database: Database, familyId: string): number {
  return database.db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.familyId, familyId), eq(schema.users.role, 'admin')))
    .all().length;
}

function buildMemberPayload(
  user:
    | {
        id: string;
        familyId: string;
        displayName: string;
        email: string | null;
        role: 'admin' | 'member' | 'child';
        color: string;
        createdAt: number;
        updatedAt: number;
      }
    | undefined,
): PublicAuthUser | null {
  if (!user) {
    return null;
  }

  return serializeUser(user);
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

  if (existing.count >= 10) {
    return false;
  }

  existing.count += 1;
  loginAttempts.set(key, existing);
  return true;
}

function clearLoginRateLimit(key: string): void {
  loginAttempts.delete(key);
}

async function createSessionForUser(
  reply: FastifyReply,
  request: { headers: Record<string, string | string[] | undefined> },
  database: Database,
  userId: string,
  config: AppConfig,
): Promise<void> {
  const sessionToken = randomToken();
  const sessionHash = hashToken(sessionToken);
  const now = Date.now();
  const userAgent = Array.isArray(request.headers['user-agent'])
    ? request.headers['user-agent'][0]
    : request.headers['user-agent'];

  database.db
    .insert(schema.sessions)
    .values({
      id: sessionHash,
      userId,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
      userAgent: userAgent ?? null,
    })
    .run();

  reply.setCookie('sid', sessionToken, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 60,
  });
}

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
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
    reply.setCookie('sid', rawSession, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: SESSION_TTL_MS / 1000,
    });

    request.user = serializeUser(userRecord);
    request.familyId = userRecord.familyId;
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
    try {
      database.db.transaction((tx) => {
        let joinCode = generateJoinCode();

        while (tx.select().from(schema.families).where(eq(schema.families.joinCode, joinCode)).get()) {
          joinCode = generateJoinCode();
        }

        tx.insert(schema.families)
          .values({
            id: familyId,
            name: familyName,
            timezone: 'Europe/Warsaw',
            joinCode,
            createdAt: now,
          })
          .run();

        tx.insert(schema.users)
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
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return sendError(reply, 409, 'CONFLICT', 'Użytkownik z tym adresem e-mail już istnieje.');
      }
      throw error;
    }

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

    if (!family || !user) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Nie można odtworzyć rodziny lub użytkownika po rejestracji.');
    }

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

    const family = database.db.select().from(schema.families).where(eq(schema.families.id, user.familyId)).get();
    if (!family) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Nie można odczytać rodziny po zalogowaniu.');
    }

    return {
      ok: true,
      user: serializeUser(user),
      family: { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode },
    };
  });

  app.get('/api/auth/family-members', async (request, reply) => {
    const joinCode = String((request.query as Record<string, unknown> | undefined)?.joinCode ?? '').trim();
    if (!joinCode) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Kod rodziny jest wymagany.');
    }

    const family = database.db.select().from(schema.families).where(eq(schema.families.joinCode, joinCode)).get();
    if (!family) {
      return sendError(reply, 404, 'NOT_FOUND', 'Nie znaleziono rodziny dla podanego kodu.');
    }

    const children = database.db
      .select({ id: schema.users.id, displayName: schema.users.displayName, color: schema.users.color })
      .from(schema.users)
      .where(and(eq(schema.users.familyId, family.id), eq(schema.users.role, 'child')))
      .orderBy(asc(schema.users.createdAt))
      .all();

    return {
      ok: true,
      members: children,
      children,
    };
  });

  app.post('/api/auth/login-child', async (request, reply) => {
    const parsed = z
      .object({
        joinCode: z.string().trim().min(1),
        userId: z.string().trim().min(1),
        pin: z.string().trim().min(4).max(6),
      })
      .safeParse(request.body ?? {});

    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Dane logowania dziecka są niepoprawne.');
    }

    const { joinCode, userId, pin } = parsed.data;
    const family = database.db.select().from(schema.families).where(eq(schema.families.joinCode, joinCode)).get();
    if (!family) {
      return sendError(reply, 404, 'NOT_FOUND', 'Nie znaleziono rodziny dla podanego kodu.');
    }

    const user = database.db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), eq(schema.users.familyId, family.id), eq(schema.users.role, 'child')))
      .get();

    if (!user || !user.pinHash) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Nieprawidłowy kod rodziny, użytkownik lub PIN.');
    }

    const loginKey = getLoginRateLimitKey(request.ip ?? 'unknown', `${family.id}:${userId}`);
    if (!checkRateLimit(loginKey)) {
      return sendError(reply, 429, 'RATE_LIMITED', 'Za dużo prób logowania. Spróbuj ponownie później.');
    }

    const isValid = await verifyPin(user.pinHash, pin);
    if (!isValid) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Nieprawidłowy kod rodziny, użytkownik lub PIN.');
    }

    clearLoginRateLimit(loginKey);
    await createSessionForUser(reply, request, database, user.id, config);

    return {
      ok: true,
      user: serializeUser(user),
      family: { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode },
    };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionToken = request.cookies?.sid;
    if (sessionToken) {
      database.db
        .delete(schema.sessions)
        .where(eq(schema.sessions.id, hashToken(sessionToken)))
        .run();
    }

    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    const family = database.db
      .select()
      .from(schema.families)
      .where(eq(schema.families.id, request.user.familyId))
      .get();
    if (!family) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Brak danych rodziny dla aktywnego użytkownika.');
    }

    return {
      ok: true,
      user: request.user,
      family: { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode },
    };
  });

  app.get('/api/members', async (request, reply) => {
    if (!request.user || !request.familyId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    const members = database.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.familyId, request.familyId))
      .orderBy(asc(schema.users.createdAt))
      .all();

    return {
      ok: true,
      members: members.map((member) => buildMemberPayload(member)),
    };
  });

  app.post('/api/members/child', async (request, reply) => {
    if (!request.user || !request.familyId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    if (!canManageFamilyMembers(request.user.role) || !canSetChildPin(request.user.role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Tylko administrator może dodać dziecko.');
    }

    const parsed = z
      .object({
        displayName: z.string().trim().min(2),
        pin: z.string().trim().min(4).max(6),
        color: z
          .string()
          .trim()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
      })
      .safeParse(request.body ?? {});

    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Dane dziecka są niepoprawne.');
    }

    const { displayName, pin, color } = parsed.data;
    if (!isValidPin(pin)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'PIN musi mieć od 4 do 6 cyfr.');
    }

    const now = Date.now();
    const memberId = crypto.randomUUID();
    const pinHash = await hashPin(pin);

    database.db
      .insert(schema.users)
      .values({
        id: memberId,
        familyId: request.familyId,
        displayName,
        email: null,
        passwordHash: null,
        pinHash,
        role: 'child',
        color: color ?? '#7BC6B9',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = database.db.select().from(schema.users).where(eq(schema.users.id, memberId)).get();
    if (!created) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Nie udało się pobrać utworzonego użytkownika.');
    }

    return reply.code(201).send({ ok: true, member: buildMemberPayload(created) });
  });

  app.post('/api/invitations', async (request, reply) => {
    if (!request.user || !request.familyId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    if (!canManageFamilyMembers(request.user.role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Tylko administrator może tworzyć zaproszenia.');
    }

    const parsed = z.object({ role: z.enum(['admin', 'member']) }).safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Rola zaproszenia jest nieprawidłowa.');
    }

    const token = randomToken();
    const now = Date.now();
    const invitationId = crypto.randomUUID();
    database.db
      .insert(schema.invitations)
      .values({
        id: invitationId,
        familyId: request.familyId,
        tokenHash: hashToken(token),
        role: parsed.data.role,
        createdBy: request.user.id,
        expiresAt: now + 1000 * 60 * 60 * 24 * 7,
        usedAt: null,
      })
      .run();

    return {
      ok: true,
      invitation: {
        id: invitationId,
        role: parsed.data.role,
        expiresAt: now + 1000 * 60 * 60 * 24 * 7,
      },
      link: `${config.RODZINA_PUBLIC_URL.replace(/\/$/, '')}/zaproszenie/${token}`,
      token,
    };
  });

  app.get('/api/invitations/:token', async (request, reply) => {
    const token = (request.params as { token?: string } | undefined)?.token;
    if (!token) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Brak tokenu zaproszenia.');
    }

    const invitation = database.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.tokenHash, hashToken(token)))
      .get();

    if (!invitation) {
      return sendError(reply, 404, 'NOT_FOUND', 'Zaproszenie nie istnieje.');
    }

    if (invitation.expiresAt <= Date.now()) {
      return sendError(reply, 410, 'EXPIRED', 'Zaproszenie wygasło.');
    }

    if (invitation.usedAt) {
      return sendError(reply, 410, 'USED', 'Zaproszenie zostało już wykorzystane.');
    }

    const family = database.db.select().from(schema.families).where(eq(schema.families.id, invitation.familyId)).get();
    if (!family) {
      return sendError(reply, 404, 'NOT_FOUND', 'Rodzina z zaproszeniem nie istnieje.');
    }

    return {
      ok: true,
      family: { id: family.id, name: family.name },
      invitation: { id: invitation.id, role: invitation.role, expiresAt: invitation.expiresAt },
    };
  });

  app.post('/api/invitations/:token/accept', async (request, reply) => {
    const token = (request.params as { token?: string } | undefined)?.token;
    if (!token) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Brak tokenu zaproszenia.');
    }

    const parsed = z
      .object({
        displayName: z.string().trim().min(2),
        email: z.string().trim().email(),
        password: z.string().min(8),
      })
      .safeParse(request.body ?? {});

    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Dane akceptacji zaproszenia są niepoprawne.');
    }

    const invitation = database.db
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.tokenHash, hashToken(token)))
      .get();

    if (!invitation) {
      return sendError(reply, 404, 'NOT_FOUND', 'Zaproszenie nie istnieje.');
    }

    if (invitation.expiresAt <= Date.now()) {
      return sendError(reply, 410, 'EXPIRED', 'Zaproszenie wygasło.');
    }

    if (invitation.usedAt) {
      return sendError(reply, 410, 'USED', 'Zaproszenie zostało już wykorzystane.');
    }

    const family = database.db.select().from(schema.families).where(eq(schema.families.id, invitation.familyId)).get();
    if (!family) {
      return sendError(reply, 404, 'NOT_FOUND', 'Rodzina z zaproszeniem nie istnieje.');
    }

    const normalizedEmail = normalizeEmail(parsed.data.email);
    const existingUser = database.db.select().from(schema.users).where(eq(schema.users.email, normalizedEmail)).get();
    if (existingUser) {
      return sendError(reply, 409, 'CONFLICT', 'Użytkownik z tym adresem e-mail już istnieje.');
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(parsed.data.password);
    const now = Date.now();

    let accepted = false;
    try {
      accepted = database.db.transaction((tx) => {
        const claimed = tx
          .update(schema.invitations)
          .set({ usedAt: now })
          .where(
            and(
              eq(schema.invitations.id, invitation.id),
              isNull(schema.invitations.usedAt),
              gt(schema.invitations.expiresAt, now),
            ),
          )
          .run();
        if (claimed.changes !== 1) return false;
        tx.insert(schema.users)
          .values({
            id: userId,
            familyId: family.id,
            displayName: parsed.data.displayName,
            email: normalizedEmail,
            passwordHash,
            role: invitation.role,
            color: '#5C7CFA',
            createdAt: now,
            updatedAt: now,
          })
          .run();
        return true;
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return sendError(reply, 409, 'CONFLICT', 'Użytkownik z tym adresem e-mail już istnieje.');
      }
      throw error;
    }
    if (!accepted) {
      return sendError(reply, 410, 'USED', 'Zaproszenie wygasło lub zostało już wykorzystane.');
    }

    await createSessionForUser(reply, request, database, userId, config);

    const created = database.db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!created) {
      return sendError(
        reply,
        500,
        'INTERNAL_ERROR',
        'Nie można odtworzyć nowego użytkownika po akceptacji zaproszenia.',
      );
    }

    return reply.code(201).send({
      ok: true,
      family: { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode },
      user: serializeUser(created),
    });
  });

  app.post('/api/members/:id/password-reset-link', async (request, reply) => {
    if (!request.user || !request.familyId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    if (!canManageFamilyMembers(request.user.role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Tylko administrator może tworzyć linki resetu hasła.');
    }

    const memberId = (request.params as { id?: string } | undefined)?.id;
    if (!memberId) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Brak identyfikatora użytkownika.');
    }

    const targetUser = findFamilyMember(database, request.familyId, memberId);
    if (!targetUser) {
      return sendError(reply, 404, 'NOT_FOUND', 'Użytkownik nie istnieje w tej rodzinie.');
    }

    if (!targetUser.email || !targetUser.passwordHash) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Użytkownik nie ma aktywnego hasła do zresetowania.');
    }

    const token = randomToken();
    const resetId = crypto.randomUUID();
    const expiresAt = Date.now() + 1000 * 60 * 60 * 24;

    database.db
      .insert(schema.passwordResets)
      .values({
        id: resetId,
        userId: targetUser.id,
        tokenHash: hashToken(token),
        expiresAt,
        usedAt: null,
      })
      .run();

    return {
      ok: true,
      token,
      link: `${config.RODZINA_PUBLIC_URL.replace(/\/$/, '')}/reset-hasla/${token}`,
      expiresAt,
    };
  });

  app.post('/api/auth/reset-password', async (request, reply) => {
    const parsed = z
      .object({
        token: z.string().trim().min(1),
        password: z.string().min(8),
      })
      .safeParse(request.body ?? {});

    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Dane resetu hasła są niepoprawne.');
    }

    const { token, password } = parsed.data;
    const resetRequest = database.db
      .select()
      .from(schema.passwordResets)
      .where(eq(schema.passwordResets.tokenHash, hashToken(token)))
      .get();

    if (!resetRequest) {
      return sendError(reply, 404, 'NOT_FOUND', 'Token resetu hasła jest nieprawidłowy.');
    }

    if (resetRequest.expiresAt <= Date.now()) {
      return sendError(reply, 410, 'EXPIRED', 'Token resetu hasła wygasł.');
    }

    if (resetRequest.usedAt) {
      return sendError(reply, 410, 'USED', 'Token resetu hasła został już wykorzystany.');
    }

    if (!isValidPassword(password)) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Hasło musi mieć co najmniej 8 znaków.');
    }

    const passwordHash = await hashPassword(password);
    const now = Date.now();

    const reset = database.db.transaction((tx) => {
      const claimed = tx
        .update(schema.passwordResets)
        .set({ usedAt: now })
        .where(
          and(
            eq(schema.passwordResets.id, resetRequest.id),
            isNull(schema.passwordResets.usedAt),
            gt(schema.passwordResets.expiresAt, now),
          ),
        )
        .run();
      if (claimed.changes !== 1) return false;
      tx.update(schema.users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(schema.users.id, resetRequest.userId))
        .run();
      return true;
    });
    if (!reset) {
      return sendError(reply, 410, 'USED', 'Token resetu hasła wygasł lub został już wykorzystany.');
    }

    return { ok: true };
  });

  app.patch('/api/members/:id', async (request, reply) => {
    if (!request.user || !request.familyId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    const memberId = (request.params as { id?: string } | undefined)?.id;
    if (!memberId) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Brak identyfikatora użytkownika.');
    }

    const targetUser = findFamilyMember(database, request.familyId, memberId);
    if (!targetUser) {
      return sendError(reply, 404, 'NOT_FOUND', 'Użytkownik nie istnieje w tej rodzinie.');
    }

    const isSelf = targetUser.id === request.user.id;
    if (!canEditMemberProfile(request.user.role, request.user.id, targetUser.id)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Brak uprawnień do edycji tego użytkownika.');
    }

    const parsed = z
      .object({
        displayName: z.string().trim().min(2).optional(),
        color: z
          .string()
          .trim()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        role: z.enum(['admin', 'member', 'child']).optional(),
        pin: z.string().trim().min(4).max(6).optional(),
      })
      .safeParse(request.body ?? {});

    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Dane użytkownika są niepoprawne.');
    }

    const update = parsed.data;
    if (request.user.role !== 'admin' && !isSelf) {
      return sendError(reply, 403, 'FORBIDDEN', 'Tylko administrator może edytować innych domowników.');
    }

    if (request.user.role !== 'admin') {
      if (update.role || update.pin) {
        return sendError(reply, 403, 'FORBIDDEN', 'Dziecko i członek nie mogą zmieniać roli ani PIN-u.');
      }
    }

    if (update.role) {
      if (!canUpdateMemberRole(request.user.role)) {
        return sendError(reply, 403, 'FORBIDDEN', 'Tylko administrator może zmieniać role.');
      }
      if ((targetUser.role === 'child') !== (update.role === 'child')) {
        return sendError(
          reply,
          400,
          'VALIDATION_ERROR',
          'Nie można zmieniać konta dziecka w konto dorosłego ani odwrotnie.',
        );
      }

      if (targetUser.role === 'admin' && update.role !== 'admin' && countAdmins(database, request.familyId) <= 1) {
        return sendError(reply, 400, 'VALIDATION_ERROR', 'Nie można odebrać ostatniej roli administratora.');
      }
    }

    if (update.pin) {
      if (!canSetChildPin(request.user.role) || (targetUser.role !== 'child' && !(update.role === 'child'))) {
        return sendError(reply, 400, 'VALIDATION_ERROR', 'PIN można ustawić tylko dla dziecka.');
      }
      if (!isValidPin(update.pin)) {
        return sendError(reply, 400, 'VALIDATION_ERROR', 'PIN musi mieć od 4 do 6 cyfr.');
      }
    }

    const nextUpdatedAt = Date.now();
    const values: Partial<typeof schema.users.$inferSelect> = {
      updatedAt: nextUpdatedAt,
    };

    if (update.displayName) {
      values.displayName = update.displayName;
    }

    if (update.color) {
      values.color = update.color;
    }

    if (request.user.role === 'admin' && update.role) {
      values.role = update.role;
    }

    if (request.user.role === 'admin' && update.pin) {
      values.pinHash = await hashPin(update.pin);
    }

    if (Object.keys(values).length <= 1) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Brak danych do zmiany.');
    }

    database.db.update(schema.users).set(values).where(eq(schema.users.id, memberId)).run();

    const updated = database.db.select().from(schema.users).where(eq(schema.users.id, memberId)).get();
    if (!updated) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Nie udało się pobrać zaktualizowanego użytkownika.');
    }

    return {
      ok: true,
      member: buildMemberPayload(updated),
    };
  });

  app.delete('/api/members/:id', async (request, reply) => {
    if (!request.user || !request.familyId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    if (!canManageFamilyMembers(request.user.role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Tylko administrator może usuwać domowników.');
    }

    const memberId = (request.params as { id?: string } | undefined)?.id;
    if (!memberId) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Brak identyfikatora użytkownika.');
    }

    const targetUser = findFamilyMember(database, request.familyId, memberId);
    if (!targetUser) {
      return sendError(reply, 404, 'NOT_FOUND', 'Użytkownik nie istnieje w tej rodzinie.');
    }

    if (targetUser.role === 'admin' && countAdmins(database, request.familyId) <= 1) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Nie można usunąć ostatniego administratora.');
    }

    database.db.delete(schema.sessions).where(eq(schema.sessions.userId, memberId)).run();
    database.db.delete(schema.users).where(eq(schema.users.id, memberId)).run();

    return { ok: true, deleted: true };
  });

  app.patch('/api/family', async (request, reply) => {
    if (!request.user || !request.familyId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    if (!canManageFamilyMembers(request.user.role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Tylko administrator może zmieniać nazwę rodziny.');
    }

    const parsed = z.object({ name: z.string().trim().min(2) }).safeParse(request.body ?? {});
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'Nazwa rodziny jest niepoprawna.');
    }

    database.db
      .update(schema.families)
      .set({ name: parsed.data.name })
      .where(eq(schema.families.id, request.familyId))
      .run();
    const updated = database.db.select().from(schema.families).where(eq(schema.families.id, request.familyId)).get();
    if (!updated) {
      return sendError(reply, 500, 'INTERNAL_ERROR', 'Nie można odczytać zaktualizowanej rodziny.');
    }

    return {
      ok: true,
      family: {
        id: updated.id,
        name: updated.name,
        timezone: updated.timezone,
        joinCode: updated.joinCode,
      },
    };
  });

  app.post('/api/family/join-code/rotate', async (request, reply) => {
    if (!request.user || !request.familyId) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    if (!canManageFamilyMembers(request.user.role)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Tylko administrator może odświeżyć kod rodziny.');
    }

    let nextJoinCode = generateJoinCode();
    while (database.db.select().from(schema.families).where(eq(schema.families.joinCode, nextJoinCode)).get()) {
      nextJoinCode = generateJoinCode();
    }

    database.db
      .update(schema.families)
      .set({ joinCode: nextJoinCode })
      .where(eq(schema.families.id, request.familyId))
      .run();

    return {
      ok: true,
      joinCode: nextJoinCode,
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
