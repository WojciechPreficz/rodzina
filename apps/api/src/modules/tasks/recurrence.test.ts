// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDateTimeToUtc, type Task, type TaskRecurrenceRule, type ConfigureTaskSeries } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { createTaskListService } from './service.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const now = Date.parse('2026-03-20T12:00:00Z');
const rule: TaskRecurrenceRule = {
  mode: 'schedule',
  unit: 'week',
  interval: 1,
  startDate: '2026-03-03',
  time: '15:00',
  timezone: 'Europe/Warsaw',
  endDate: null,
  weekdays: [2],
};

describe('task recurrence API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;
  let familyId: string;
  let owner: { id: string; cookie: string };
  let child: typeof owner;
  let outsider: typeof owner;
  let admin: typeof owner;
  let listId: string;
  let taskId: string;
  let config: ConfigureTaskSeries;

  function actor(family: string, role: 'admin' | 'member' | 'child') {
    const id = randomUUID(),
      token = randomUUID();
    database.db
      .insert(schema.users)
      .values({ id, familyId: family, displayName: role, role, createdAt: 1, updatedAt: 1 })
      .run();
    database.db
      .insert(schema.sessions)
      .values({ id: hashToken(token), userId: id, createdAt: 1, expiresAt: Date.UTC(2100, 0, 1) })
      .run();
    return { id, cookie: `sid=${token}` };
  }
  function family() {
    const id = randomUUID();
    database.db.insert(schema.families).values({ id, name: 'Test', joinCode: id, createdAt: 1 }).run();
    return id;
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
  function write(
    method: 'POST' | 'PATCH' | 'DELETE',
    url: string,
    data?: unknown,
    user = owner,
    operationId = randomUUID(),
  ) {
    return request(method, `${url}?operationId=${operationId}&actorId=${user.id}`, data, user);
  }
  async function configure(data = config, user = owner) {
    const result = await write('POST', `/api/tasks/${taskId}/recurrence`, data, user);
    expect(result.statusCode, result.body).toBe(201);
    return result.json().series.id as string;
  }
  async function tasks(status = 'all'): Promise<Task[]> {
    return (await request('GET', `/api/tasks/lists/${listId}/tasks?status=${status}`)).json().tasks;
  }
  async function series(id: string) {
    return (await request('GET', `/api/tasks/series/${id}`)).json();
  }
  async function history(id: string) {
    return (await request('GET', `/api/tasks/series/${id}/history`)).json().history;
  }
  function complete(id = taskId, data: object = {}, user = owner) {
    return write('PATCH', `/api/tasks/${id}`, { isDone: true, ...data }, user);
  }
  function reopen() {
    return write('PATCH', `/api/tasks/${taskId}`, { isDone: false });
  }

  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const cfg = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
    database = createDatabase(cfg);
    migrate(database.db, { migrationsFolder });
    app = await buildApp(cfg, database);
    familyId = family();
    owner = actor(familyId, 'member');
    child = actor(familyId, 'child');
    admin = actor(familyId, 'admin');
    outsider = actor(family(), 'admin');
    const list = await request('POST', '/api/tasks/lists', { name: 'Duties', memberIds: [child.id] });
    listId = list.json().list.id;
    taskId = (await request('POST', `/api/tasks/lists/${listId}/tasks`, { title: 'Original' })).json().task.id;
    database.db
      .update(schema.tasks)
      .set({ createdAt: now - 30 * 86400000 })
      .where(eq(schema.tasks.id, taskId))
      .run();
    config = {
      rule,
      template: {
        title: 'Template',
        notes: null,
        assigneeId: child.id,
        reminders: [{ type: 'offset', offsetValue: 1, offsetUnit: 'hour', audience: 'owner' }],
      },
      expectedVersion: 0,
      expectedOccurrenceVersion: 0,
    };
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    database?.sqlite.close();
  });

  it.each(['schedule', 'after_completion'] as const)(
    'closes %s once across two devices, replays and computes from actual time',
    async (mode) => {
      const id = await configure({
        ...config,
        rule: mode === 'schedule' ? rule : { ...rule, mode, weekdays: undefined, interval: 2 },
      });
      const url = `/api/tasks/${taskId}?operationId=${randomUUID()}`;
      const first = await request('PATCH', url, {
        isDone: true,
        closedAt: now - 60000,
        expectedSeriesVersion: 0,
        expectedOccurrenceVersion: 0,
      });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().task.doneAt).toBe(now - 60000);
      expect(first.json().task.recurrence).toMatchObject({ state: 'done', closedAt: now - 60000, version: 1 });
      expect(
        (
          await request('PATCH', url, {
            isDone: true,
            closedAt: now - 60000,
            expectedSeriesVersion: 0,
            expectedOccurrenceVersion: 0,
          })
        ).body,
      ).toBe(first.body);
      const results = await Promise.all([complete(taskId, {}, child), complete()]);
      expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
      const all = await tasks();
      expect(all).toHaveLength(2);
      const active = all.find((t) => !t.isDone)!;
      expect(active).toMatchObject({
        title: 'Template',
        assigneeId: child.id,
        dueDate: mode === 'schedule' ? '2026-03-24' : '2026-04-03',
        recurrence: { sequence: 1, state: 'active' },
      });
      expect(await history(id)).toHaveLength(1);
      expect(
        (await complete(taskId, { expectedSeriesVersion: 0, expectedOccurrenceVersion: 0, closedAt: now })).statusCode,
      ).toBe(409);
      expect((await series(id)).series.version).toBe(1);
    },
  );

  it('handles simultaneous versioned closures with different operation IDs atomically', async () => {
    const id = await configure();
    const data = { closedAt: now, expectedSeriesVersion: 0, expectedOccurrenceVersion: 0 };
    const results = await Promise.all([complete(taskId, data), complete(taskId, data, child)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await tasks('open')).toHaveLength(1);
    expect(await history(id)).toHaveLength(1);
  });

  it('distinguishes one-off edits and this-and-future configuration, and rejects pending stale completion', async () => {
    const id = await configure();
    expect(
      (await write('PATCH', `/api/tasks/${taskId}`, { title: 'Only once', dueDate: '2026-03-21' })).statusCode,
    ).toBe(200);
    expect((await series(id)).series.template.title).toBe('Template');
    const stale = await complete(taskId, { closedAt: now, expectedSeriesVersion: 0, expectedOccurrenceVersion: 0 });
    expect(stale.statusCode).toBe(409);
    expect((await tasks('open'))[0]!.title).toBe('Only once');
    const data = { ...config, template: { ...config.template, title: 'Future' }, expectedOccurrenceVersion: 1 };
    const url = `/api/tasks/series/${id}?operationId=${randomUUID()}`;
    const updated = await request('PATCH', url, data);
    expect(updated.statusCode, updated.body).toBe(200);
    expect((await request('PATCH', url, data)).body).toBe(updated.body);
    expect(
      (await complete(taskId, { closedAt: now, expectedSeriesVersion: 0, expectedOccurrenceVersion: 1 })).statusCode,
    ).toBe(409);
    expect((await write('PATCH', `/api/tasks/series/${id}`, data)).statusCode).toBe(409);
    await complete();
    expect((await tasks('open'))[0]!.title).toBe('Future');
    expect((await history(id))[0].title).toBe('Future');
    expect(
      (await write('PATCH', `/api/tasks/series/${id}`, { ...data, expectedVersion: 2, expectedOccurrenceVersion: 0 }))
        .statusCode,
    ).toBe(200);
    expect((await history(id))[0].title).toBe('Future');
  });

  it.each(['skip', 'delete'] as const)(
    'records %s separately and preserves history after clearing completed rows',
    async (action) => {
      const id = await configure();
      const result =
        action === 'delete'
          ? await write('DELETE', `/api/tasks/${taskId}`)
          : await write('POST', `/api/tasks/${taskId}/skip`, {
              expectedSeriesVersion: 0,
              expectedOccurrenceVersion: 0,
              closedAt: now,
            });
      expect(result.statusCode, result.body).toBe(200);
      expect((await history(id))[0]).toMatchObject({ state: 'skipped', closedBy: owner.id, closedAt: now });
      if (action === 'skip') expect((await write('DELETE', `/api/tasks/${taskId}`)).statusCode).toBe(200);
      const next = (await tasks('open'))[0]!;
      await complete(next.id);
      await write('DELETE', `/api/tasks/${next.id}`);
      expect(await history(id)).toHaveLength(2);
      expect(await tasks('open')).toHaveLength(1);
      expect((await series(id)).series.state).toBe('active');
      expect((await request('DELETE', `/api/tasks/lists/${listId}`)).statusCode).toBe(200);
      expect(database.db.select().from(schema.taskSeries).all()).toEqual([]);
      expect(database.db.select().from(schema.taskSeriesHistory).all()).toEqual([]);
      expect(database.db.select().from(schema.reminders).all()).toEqual([]);
    },
  );

  it('stops explicitly, detaches the active task and does not resume through old PATCH', async () => {
    const id = await configure();
    await complete();
    const active = (await tasks('open'))[0]!;
    const url = `/api/tasks/series/${id}/stop?operationId=${randomUUID()}`;
    const data = { expectedVersion: 1, expectedOccurrenceVersion: 0 };
    const stopped = await request('POST', url, data, child);
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect((await request('POST', url, data, child)).body).toBe(stopped.body);
    expect((await tasks('open'))[0]!.recurrence).toBeNull();
    expect((await reopen()).statusCode).toBe(409);
    await complete(active.id);
    expect(await tasks('open')).toEqual([]);
    expect(await history(id)).toHaveLength(1);
  });

  it('undoes atomically with an untouched successor, preserves reversal history and can close again', async () => {
    const id = await configure();
    await complete();
    const successorId = (await tasks('open'))[0]!.id;
    const result = await reopen();
    expect(result.statusCode, result.body).toBe(200);
    expect(await tasks()).toHaveLength(1);
    expect((await tasks())[0]).toMatchObject({ id: taskId, isDone: false, recurrence: { state: 'active' } });
    expect(
      database.db
        .select()
        .from(schema.reminders)
        .all()
        .some((r) => r.taskId === successorId),
    ).toBe(false);
    expect((await history(id))[0]).toMatchObject({ undoneAt: now, undoneBy: owner.id });
    await complete();
    expect(await tasks('open')).toHaveLength(1);
    expect(await history(id)).toHaveLength(2);
  });

  it.each(['task', 'checklist', 'reminder', 'completion', 'delete', 'configuration'] as const)(
    'rejects undo after successor %s changes',
    async (change) => {
      const id = await configure();
      await complete();
      const successor = (await tasks('open'))[0]!;
      if (change === 'task') {
        await write('PATCH', `/api/tasks/${successor.id}`, { title: 'Changed' });
        await write('PATCH', `/api/tasks/${successor.id}`, { title: 'Template' });
      }
      if (change === 'checklist') {
        const itemId = randomUUID();
        await write('POST', `/api/tasks/${successor.id}/checklist`, { id: itemId, title: 'New' });
        await write('DELETE', `/api/tasks/${successor.id}/checklist/${itemId}`, { version: 0, doneVersion: 0 });
      }
      if (change === 'reminder') {
        const personal = await request(
          'POST',
          '/api/reminders/mine',
          { taskId: successor.id, type: 'offset', offsetValue: 1, offsetUnit: 'hour' },
          child,
        );
        expect(personal.statusCode).toBe(200);
        expect(
          (await request('DELETE', `/api/reminders/mine/${personal.json().reminder.id}`, {}, child)).statusCode,
        ).toBe(200);
      }
      if (change === 'completion') await complete(successor.id);
      if (change === 'delete') await write('DELETE', `/api/tasks/${successor.id}`);
      if (change === 'configuration')
        await write('PATCH', `/api/tasks/series/${id}`, { ...config, expectedVersion: 1 });
      expect((await reopen()).statusCode).toBe(409);
      expect((await tasks()).find((t) => t.id === taskId)!.isDone).toBe(true);
    },
  );

  it('ends at the inclusive boundary and allows undo without a successor', async () => {
    const id = await configure({ ...config, rule: { ...rule, endDate: '2026-03-03' } });
    await complete();
    expect(await tasks('open')).toEqual([]);
    expect((await series(id)).series.state).toBe('ended');
    expect((await reopen()).statusCode).toBe(200);
    expect((await series(id)).series.state).toBe('active');
  });

  it('recomputes only template relative shared reminders for the next deadline and current assignee', async () => {
    const id = await configure();
    await request('POST', '/api/reminders/mine', { taskId, type: 'offset', offsetValue: 1, offsetUnit: 'hour' }, child);
    await write('PATCH', `/api/tasks/${taskId}`, {
      assigneeId: owner.id,
      reminders: [{ type: 'absolute', remindAt: now + 3600000, audience: 'list_members' }],
    });
    await complete();
    const next = (await tasks('open'))[0]!;
    expect(next.assigneeId).toBe(child.id);
    expect(next.reminders).toHaveLength(1);
    expect(next.reminders![0]).toMatchObject({
      type: 'offset',
      audience: 'owner',
      nextFireAt: localDateTimeToUtc('2026-03-24', '14:00', 'Europe/Warsaw'),
    });
    expect(
      database.db
        .select()
        .from(schema.reminders)
        .all()
        .filter((r) => r.taskId === taskId)
        .every((r) => r.nextFireAt === null),
    ).toBe(true);
    const schedule = (await request('GET', '/api/reminders/schedule?includeTasks=true', undefined, child)).json();
    expect(JSON.stringify(schedule)).toContain(next.id);
    expect(JSON.stringify((await request('GET', '/api/reminders/schedule?includeTasks=true')).json())).not.toContain(
      next.id,
    );
    expect((await series(id)).series.template.reminders).toHaveLength(1);
  });

  it('publishes additive recurrence and capability in every task read, including today and snapshot', async () => {
    await configure();
    for (const url of [`/api/tasks/lists/${listId}/tasks`, '/api/tasks/today']) {
      const result = (await request('GET', url)).json();
      expect(result.taskRecurrenceVersion).toBe(1);
      expect(result.tasks[0].recurrence).toMatchObject({ state: 'active', version: 0, seriesVersion: 0 });
    }
    const snapshot = (await request('GET', '/api/tasks/snapshot')).json();
    expect(snapshot.taskRecurrenceVersion).toBe(1);
    expect(snapshot.items[listId][0].recurrence.state).toBe('active');
    const oneOff = await request('POST', `/api/tasks/lists/${listId}/tasks`, { title: 'One-off' });
    expect(oneOff.json()).toMatchObject({ taskRecurrenceVersion: 1, task: { recurrence: null } });
    await complete();
    expect((await request('GET', '/api/tasks/today')).json().tasks).toEqual([]);
  });

  it.each(['future', 'before_creation', 'server_regression'] as const)(
    'rolls back anomalous %s closure without a successor',
    async (anomaly) => {
      await configure();
      if (anomaly === 'server_regression') vi.mocked(Date.now).mockReturnValue(now - 1);
      const result = await complete(taskId, {
        closedAt: anomaly === 'future' ? now + 300001 : anomaly === 'before_creation' ? now - 31 * 86400000 : now,
        expectedSeriesVersion: 0,
        expectedOccurrenceVersion: 0,
      });
      expect(result.statusCode).toBe(409);
      expect(result.json().error.code).toBe('TASK_CLOSURE_TIME_REVIEW');
      expect(await tasks()).toHaveLength(1);
      expect((await tasks())[0]!.isDone).toBe(false);
      expect(database.db.select().from(schema.taskSeriesHistory).all()).toEqual([]);
    },
  );

  it('rolls back the task, successor, reminders and operation record when history persistence fails', async () => {
    await configure();
    database.sqlite.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON task_series_history BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    expect((await complete()).statusCode).toBe(500);
    expect(await tasks()).toHaveLength(1);
    expect((await tasks())[0]!.isDone).toBe(false);
    expect(database.db.select().from(schema.taskSeriesHistory).all()).toEqual([]);
    expect(database.db.select().from(schema.taskOperations).all()).toHaveLength(1);
  });

  it('checks access for configuration, reads, mutations and replay after a share is revoked', async () => {
    for (const user of [admin, outsider])
      expect((await write('POST', `/api/tasks/${taskId}/recurrence`, config, user)).statusCode).toBe(404);
    const id = await configure(config, child);
    for (const user of [admin, outsider]) {
      for (const suffix of ['', '/history'])
        expect((await request('GET', `/api/tasks/series/${id}${suffix}`, undefined, user)).statusCode).toBe(404);
      expect((await write('PATCH', `/api/tasks/series/${id}`, config, user)).statusCode).toBe(404);
      expect(
        (
          await write(
            'POST',
            `/api/tasks/series/${id}/stop`,
            { expectedVersion: 0, expectedOccurrenceVersion: 0 },
            user,
          )
        ).statusCode,
      ).toBe(404);
    }
    const op = randomUUID(),
      data = { expectedSeriesVersion: 0, expectedOccurrenceVersion: 0, closedAt: now };
    const skipped = await write('POST', `/api/tasks/${taskId}/skip`, data, child, op);
    expect(skipped.statusCode, skipped.body).toBe(200);
    expect((await write('POST', `/api/tasks/${taskId}/skip`, data, child, op)).body).toBe(skipped.body);
    await request('PATCH', `/api/tasks/lists/${listId}`, { memberIds: [] });
    expect((await write('POST', `/api/tasks/${taskId}/skip`, data, child, op)).statusCode).toBe(404);
    expect((await series(id)).series.template.assigneeId).toBeNull();
    const next = (await tasks('open'))[0]!;
    expect(next.assigneeId).toBeNull();
    await complete(next.id);
    expect((await tasks('open'))[0]!.assigneeId).toBeNull();
  });

  it('clears the future assignee on member removal while retaining closure history anonymously', async () => {
    const id = await configure();
    await complete(taskId, {}, child);
    createTaskListService(database).prepareMemberRemoval(familyId, child.id);
    database.db.delete(schema.users).where(eq(schema.users.id, child.id)).run();
    expect((await history(id))[0].closedBy).toBeNull();
    expect((await series(id)).series.template.assigneeId).toBeNull();
    expect((await complete((await tasks('open'))[0]!.id)).statusCode).toBe(200);
    expect((await tasks('open'))[0]!.assigneeId).toBeNull();
    expect((await request('GET', `/api/tasks/series/${id}`, undefined, child)).statusCode).toBe(401);
  });

  it('requires idempotency, complete versions, a valid rule and a permitted future assignee', async () => {
    expect((await request('POST', `/api/tasks/${taskId}/recurrence`, config)).statusCode).toBe(400);
    for (const fields of [
      { expectedVersion: -1 },
      { expectedOccurrenceVersion: undefined },
      { rule: { ...rule, interval: 0 } },
      { rule: { ...rule, timezone: 'UTC' } },
      { template: { ...config.template, assigneeId: outsider.id } },
      { template: { ...config.template, reminders: [{ type: 'absolute', remindAt: now, audience: 'owner' }] } },
    ])
      expect((await write('POST', `/api/tasks/${taskId}/recurrence`, { ...config, ...fields })).statusCode).toBe(400);
    const id = await configure();
    expect((await write('POST', `/api/tasks/${taskId}/recurrence`, config)).statusCode).toBe(409);
    expect(
      (await write('POST', `/api/tasks/series/${id}/stop`, { expectedVersion: 1, expectedOccurrenceVersion: 0 }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await write('POST', `/api/tasks/${taskId}/skip`, {
          expectedSeriesVersion: 0,
          expectedOccurrenceVersion: 1,
          closedAt: now,
        })
      ).statusCode,
    ).toBe(409);
    expect((await complete(taskId, { closedAt: now })).statusCode).toBe(400);
    expect((await complete(taskId, { expectedSeriesVersion: 0 })).statusCode).toBe(400);
    expect(await tasks('open')).toHaveLength(1);
    expect(await history(id)).toEqual([]);
  });

  it('rejects closure before the previous actual time and ignores alarm delivery bookkeeping during undo', async () => {
    await configure();
    await complete();
    const successor = (await tasks('open'))[0]!;
    const result = await complete(successor.id, {
      closedAt: now - 1,
      expectedSeriesVersion: 1,
      expectedOccurrenceVersion: 0,
    });
    expect(result.statusCode).toBe(409);
    expect(result.json().error.code).toBe('TASK_CLOSURE_TIME_REVIEW');
    database.db
      .update(schema.reminders)
      .set({ lastSentAt: now, nextFireAt: null })
      .where(eq(schema.reminders.taskId, successor.id))
      .run();
    expect((await reopen()).statusCode).toBe(200);
  });
});
