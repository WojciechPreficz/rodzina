// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDateTimeToUtc, reminderScheduleSchema, taskUrl, type Task, type TaskList } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { resolveRecipients } from './delivery.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const offset = { type: 'offset', offsetValue: 0, offsetUnit: 'day' };
const utc = (date: string, time = '09:00') => localDateTimeToUtc(date, time, 'Europe/Warsaw');

describe('task reminders', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let familyId: string;
  type Actor = { id: string; cookie: string };
  let owner: Actor, member: Actor, admin: Actor, child: Actor, outsider: Actor;
  function family() {
    const id = crypto.randomUUID();
    database.db.insert(schema.families).values({ id, name: 'Rodzina', joinCode: id, createdAt: 1 }).run();
    return id;
  }
  function actor(familyId: string, role: 'admin' | 'member' | 'child'): Actor {
    const id = crypto.randomUUID(),
      token = crypto.randomUUID();
    database.db
      .insert(schema.users)
      .values({ id, familyId, displayName: role, role, createdAt: 1, updatedAt: 1 })
      .run();
    database.db
      .insert(schema.sessions)
      .values({ id: hashToken(token), userId: id, createdAt: 1, expiresAt: Date.UTC(2100, 0, 1) })
      .run();
    return { id, cookie: `sid=${token}` };
  }
  function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, user = owner) {
    return app.inject({
      method,
      url,
      headers: {
        cookie: user.cookie,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      ...(method === 'GET' ? {} : { payload: JSON.stringify(payload ?? {}) }),
    });
  }
  async function list(memberIds = [member.id, child.id], user = owner): Promise<TaskList> {
    const response = await request('POST', '/api/tasks/lists', { name: 'Prywatna lista remontu', memberIds }, user);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().list;
  }
  async function task(listId: string, data: Record<string, unknown> = {}): Promise<Task> {
    const response = await request('POST', `/api/tasks/lists/${listId}/tasks`, {
      title: 'Poufny tytuł',
      notes: 'Poufna notatka',
      dueDate: '2026-10-25',
      reminders: [offset],
      ...data,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().task;
  }
  async function schedule(user = owner, includeTasks = true) {
    const response = await request(
      'GET',
      `/api/reminders/schedule${includeTasks ? '?includeTasks=true' : ''}`,
      undefined,
      user,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return reminderScheduleSchema.parse(response.json()).reminders;
  }
  async function mine(taskId: string, user = member) {
    const response = await request('POST', '/api/reminders/mine', { taskId, ...offset }, user);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().reminder;
  }
  const stored = (taskId: string) =>
    database.db.select().from(schema.reminders).where(eq(schema.reminders.taskId, taskId)).all();
  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(utc('2026-10-20'));
    const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder });
    app = await buildApp(config, database);
    familyId = family();
    owner = actor(familyId, 'member');
    member = actor(familyId, 'member');
    admin = actor(familyId, 'admin');
    child = actor(familyId, 'child');
    outsider = actor(family(), 'admin');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    database?.sqlite.close();
  });

  it('targets the owner or assignee and uses an absolute date without private text', async () => {
    const source = await task((await list()).id);
    expect(source.reminders?.[0]).toMatchObject({
      taskId: source.id,
      eventId: null,
      audience: 'owner',
      nextFireAt: utc('2026-10-25'),
    });
    const entries = await schedule();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      sourceType: 'task',
      sourceId: source.id,
      title: 'Przypomnienie o zadaniu',
      fireAt: utc('2026-10-25'),
      url: taskUrl(source.listId, source.id),
    });
    expect(entries[0]?.body).toContain('25.10.2026');
    expect(JSON.stringify(entries)).not.toMatch(/Poufny|Poufna|remontu|Dziś/i);
    expect(await schedule(member)).toEqual([]);
    expect(await schedule(admin)).toEqual([]);
    expect(await schedule(outsider)).toEqual([]);
    expect(await schedule(owner, false)).toEqual([]);
    await request('PATCH', `/api/tasks/${source.id}`, { assigneeId: child.id });
    expect(await schedule()).toEqual([]);
    expect(await schedule(child)).toHaveLength(1);
    await request('PATCH', `/api/tasks/${source.id}`, { assigneeId: null });
    expect(await schedule()).toHaveLength(1);
  });

  it('includes only current list members and preserves personal reminders during shared edits', async () => {
    const source = await task((await list()).id, { reminders: [{ ...offset, audience: 'list_members' }] });
    const personal = await mine(source.id);
    for (const user of [owner, member, child]) expect(await schedule(user)).toHaveLength(user === member ? 2 : 1);
    expect(await schedule(admin)).toEqual([]);
    const update = await request('PATCH', `/api/tasks/${source.id}`, { reminders: [] }, child);
    expect(update.statusCode, update.body).toBe(200);
    expect(stored(source.id).map((r) => r.id)).toEqual([personal.id]);
    const own = await request('GET', `/api/reminders/mine?taskId=${source.id}`, undefined, member);
    expect(own.json().reminders.map((r: { id: string }) => r.id)).toEqual([personal.id]);
    expect((await request('GET', `/api/reminders/mine?taskId=${source.id}`)).json().reminders).toEqual([]);
    expect((await request('DELETE', `/api/reminders/mine/${personal.id}`)).statusCode).toBe(404);
  });

  it.each(['family', 'adults', 'participants', 'user'])(
    'rejects shared audience %s on creation and update',
    async (audience) => {
      const target = await list();
      const data = { title: 'Zadanie', dueDate: '2026-10-25', reminders: [{ ...offset, audience }] };
      expect((await request('POST', `/api/tasks/lists/${target.id}/tasks`, data)).statusCode).toBe(400);
      const source = await task(target.id);
      expect((await request('PATCH', `/api/tasks/${source.id}`, { reminders: data.reminders })).statusCode).toBe(400);
      expect(stored(source.id)).toHaveLength(1);
    },
  );

  it.each(['leave', 'revoke'])(
    'removes shared and personal entries after %s and denies all personal operations',
    async (action) => {
      const target = await list();
      const source = await task(target.id, {
        assigneeId: member.id,
        reminders: [{ ...offset, audience: 'list_members' }],
      });
      const personal = await mine(source.id);
      expect(await schedule(member)).toHaveLength(2);
      const result =
        action === 'leave'
          ? await request('POST', `/api/tasks/lists/${target.id}/leave`, {}, member)
          : await request('PATCH', `/api/tasks/lists/${target.id}`, { memberIds: [child.id] });
      expect(result.statusCode, result.body).toBe(200);
      expect(await schedule(member)).toEqual([]);
      expect(await schedule(admin)).toEqual([]);
      expect((await request('GET', `/api/reminders/mine?taskId=${source.id}`, undefined, member)).statusCode).toBe(404);
      expect((await request('POST', '/api/reminders/mine', { ...offset, taskId: source.id }, member)).statusCode).toBe(
        404,
      );
      expect((await request('DELETE', `/api/reminders/mine/${personal.id}`, {}, member)).statusCode).toBe(404);
    },
  );

  it('recomputes all reminders on completion, reopening and deadline changes', async () => {
    const source = await task((await list()).id, { dueTime: '14:30' });
    await mine(source.id);
    expect(stored(source.id).every((r) => r.nextFireAt === utc('2026-10-25', '14:30'))).toBe(true);
    await request('PATCH', `/api/tasks/${source.id}`, { isDone: true });
    expect(stored(source.id).every((r) => r.nextFireAt === null)).toBe(true);
    expect(await schedule()).toEqual([]);
    expect(await schedule(member)).toEqual([]);
    await request('PATCH', `/api/tasks/${source.id}`, { isDone: false, dueDate: '2026-10-26' });
    expect(stored(source.id).every((r) => r.nextFireAt === utc('2026-10-26', '14:30'))).toBe(true);
    expect((await schedule())[0]?.fireAt).toBe(utc('2026-10-26', '14:30'));
    await request('PATCH', `/api/tasks/${source.id}`, { dueDate: null, dueTime: null });
    expect(stored(source.id).every((r) => r.nextFireAt === null)).toBe(true);
    expect(await schedule(member)).toEqual([]);
    await request('PATCH', `/api/tasks/${source.id}`, { dueDate: '2026-10-27' });
    expect((await schedule())[0]?.fireAt).toBe(utc('2026-10-27'));
  });

  it('requires a deadline, exactly one source and access even for an administrator', async () => {
    const target = await list([]);
    expect(
      (await request('POST', `/api/tasks/lists/${target.id}/tasks`, { title: 'x', reminders: [offset] })).statusCode,
    ).toBe(400);
    const source = await task(target.id, { dueDate: null, reminders: [] });
    expect((await request('POST', '/api/reminders/mine', { taskId: source.id, ...offset })).statusCode).toBe(400);
    for (const user of [admin, member, outsider]) {
      expect((await request('POST', '/api/reminders/mine', { taskId: source.id, ...offset }, user)).statusCode).toBe(
        404,
      );
      expect((await request('GET', `/api/reminders/mine?taskId=${source.id}`, undefined, user)).statusCode).toBe(404);
    }
    expect(
      (await request('POST', '/api/reminders/mine', { taskId: source.id, eventId: crypto.randomUUID(), ...offset }))
        .statusCode,
    ).toBe(400);
    expect((await request('POST', '/api/reminders/mine', { ...offset })).statusCode).toBe(400);
  });

  it('keeps absolute reminders fixed and omits elapsed, completed or out-of-window entries', async () => {
    const source = await task((await list()).id, { reminders: [{ type: 'absolute', remindAt: utc('2026-10-24') }] });
    await request('PATCH', `/api/tasks/${source.id}`, { dueDate: '2027-10-25' });
    expect((await schedule())[0]?.fireAt).toBe(utc('2026-10-24'));
    vi.spyOn(Date, 'now').mockReturnValue(utc('2026-10-24'));
    expect(await schedule()).toEqual([]);
    await request('PATCH', `/api/tasks/${source.id}`, { reminders: [offset] });
    expect(await schedule()).toEqual([]);
  });

  it.each(['task', 'list'])('cascades shared and personal reminders on %s deletion', async (kind) => {
    const target = await list();
    const source = await task(target.id);
    await mine(source.id);
    expect(stored(source.id)).toHaveLength(2);
    expect(
      (await request('DELETE', kind === 'task' ? `/api/tasks/${source.id}` : `/api/tasks/lists/${target.id}`))
        .statusCode,
    ).toBe(200);
    expect(stored(source.id)).toEqual([]);
    expect(await schedule()).toEqual([]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('never falls back to adults or sends malformed sources and audiences outside the list', async () => {
    const target = await list([]);
    const source = await task(target.id);
    const reminder = stored(source.id)[0]!;
    const members = database.db.select().from(schema.users).all();
    for (const invalid of [
      { ...reminder, audience: 'family' as const },
      { ...reminder, audience: 'adults' as const },
      { ...reminder, audience: 'user' as const, userId: admin.id },
      { ...reminder, familyId: crypto.randomUUID() },
      { ...reminder, eventId: crypto.randomUUID() },
    ])
      expect(resolveRecipients(invalid, { task: source, list: target, members })).toEqual([]);
    expect(resolveRecipients(reminder, { task: { ...source, assigneeId: admin.id }, list: target, members })).toEqual(
      [],
    );
    expect(resolveRecipients(reminder, { task: source, list: target, members: [] })).toEqual([]);
  });

  it('transfers shared-list reminders when the owner is removed and cascades their personal reminders', async () => {
    const target = await list([member.id]);
    const source = await task(target.id);
    await mine(source.id, owner);
    const response = await request('DELETE', `/api/members/${owner.id}`, {}, admin);
    expect(response.statusCode, response.body).toBe(200);
    expect(stored(source.id)).toHaveLength(1);
    expect((await schedule(member))[0]?.sourceId).toBe(source.id);
    expect(await schedule(admin)).toEqual([]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
