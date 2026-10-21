import { registerAuthRoutes } from './modules/auth/routes.js';
import { createSessionFactory } from './modules/auth/session.js';
import { registerSecurityHeaders } from './http/security-headers.js';
import { registerSessionAuth } from './http/session-auth.js';
import { serializeUser, type PublicAuthUser } from './http/user.js';
import { registerApiErrorHandler } from './http/errors.js';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { z } from 'zod';
import { generateJoinCode, hashPassword, hashPin, hashToken, isValidPin, normalizeEmail, randomToken } from './auth.js';
import { canEditMemberProfile, canManageFamilyMembers, canSetChildPin, canUpdateMemberRole } from './permissions.js';
import type { AppConfig } from './config.js';
import type { createDatabase } from './db/client.js';
import * as schema from './db/schema.js';
import { registerEventRoutes } from './modules/events/routes.js';
import { registerReminderRoutes } from './modules/reminders/routes.js';
import { registerShoppingRoutes } from './modules/shopping/routes.js';
import { registerTaskListRoutes } from './modules/tasks/routes.js';
import { createTaskListService } from './modules/tasks/service.js';
import { registerAndroidDownloads } from './android-downloads.js';

type Database = ReturnType<typeof createDatabase>;

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

function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

export async function buildApp(config: AppConfig, database: Database): Promise<FastifyInstance> {
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
  const createSession = createSessionFactory(database, config);
  const version = process.env.npm_package_version ?? '0.1.0';

  registerApiErrorHandler(app);
  registerSecurityHeaders(app, config);

  await app.register(fastifyCookie);

  registerSessionAuth(app, database, config);
  registerAuthRoutes(app, database, config);

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

    await createSession(reply, request, userId);

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

    database.db.transaction(
      () => {
        createTaskListService(database).prepareMemberRemoval(request.familyId!, memberId);
        database.db.delete(schema.sessions).where(eq(schema.sessions.userId, memberId)).run();
        database.db.delete(schema.users).where(eq(schema.users.id, memberId)).run();
      },
      { behavior: 'immediate' },
    );

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

  registerEventRoutes(app, database);
  registerShoppingRoutes(app, database);
  registerTaskListRoutes(app, database);
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
      if (request.url.startsWith('/api/') || request.url.startsWith('/downloads/')) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu.' },
        });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
