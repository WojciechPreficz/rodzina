// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { taskResponseSchema, tasksResponseSchema, type Task, type TaskList } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { createTaskListService } from './service.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const base = '/api/tasks/lists';

describe('task lists API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;
  let familyId: string;
  let admin: { id: string; cookie: string };
  let owner: typeof admin;
  let member: typeof admin;
  let child: typeof admin;
  let outsider: typeof admin;

  function family() {
    const id = crypto.randomUUID();
    database.db.insert(schema.families).values({ id, name: 'Rodzina', joinCode: id, createdAt: 1 }).run();
    return id;
  }
  function actor(familyId: string, role: 'admin' | 'member' | 'child', createdAt: number) {
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    database.db
      .insert(schema.users)
      .values({ id, familyId, displayName: role, role, createdAt, updatedAt: createdAt })
      .run();
    database.db
      .insert(schema.sessions)
      .values({
        id: hashToken(token),
        userId: id,
        expiresAt: Date.UTC(2100, 0, 1),
        createdAt,
      })
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
  async function lists(user = owner): Promise<TaskList[]> {
    const response = await request('GET', base, undefined, user);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return response.json().lists;
  }
  async function defaultList(user = owner): Promise<TaskList> {
    const list = (await lists(user))[0];
    expect(list).toBeDefined();
    return list!;
  }
  async function create(memberIds: string[] = [], user = owner): Promise<TaskList> {
    const response = await request('POST', base, { name: 'Remont', memberIds }, user);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().list;
  }
  function task(listId: string, userId = owner.id) {
    const id = crypto.randomUUID();
    database.db
      .insert(schema.tasks)
      .values({
        id,
        listId,
        title: 'Prywatna treść',
        notes: 'Notatka',
        dueDate: '2028-05-01',
        dueTime: '12:00',
        assigneeId: userId,
        isDone: true,
        doneBy: userId,
        doneAt: 1,
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    return id;
  }
  it('returns only accessible complete lists in snapshots and removes revoked shares', async () => {
    const shared = await create([member.id]);
    const privateList = await create();
    const foreign = await create([], outsider);
    const sharedTask = task(shared.id);
    task(privateList.id);
    task(foreign.id, outsider.id);
    const snapshot = (await request('GET', '/api/tasks/snapshot', undefined, member)).json();
    expect(snapshot.lists.some((list: TaskList) => list.id === shared.id)).toBe(true);
    expect(Object.values(snapshot.items).flat()).toEqual([expect.objectContaining({ id: sharedTask })]);
    expect(snapshot.items[privateList.id]).toBeUndefined();
    expect(snapshot.items[foreign.id]).toBeUndefined();
    await request('PATCH', base + '/' + shared.id, { memberIds: [] });
    const revoked = await request('GET', '/api/tasks/snapshot', undefined, member);
    expect(revoked.statusCode).toBe(200);
    expect(revoked.headers['cache-control']).toBe('no-store');
    expect(revoked.json().items[shared.id]).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/tasks/snapshot' })).statusCode).toBe(401);
  });
  beforeEach(async () => {
    database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
    migrate(database.db, { migrationsFolder });
    app = await buildApp(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }), database);
    familyId = family();
    admin = actor(familyId, 'admin', 1);
    owner = actor(familyId, 'member', 2);
    member = actor(familyId, 'member', 3);
    child = actor(familyId, 'child', 4);
    outsider = actor(family(), 'admin', 5);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    database?.sqlite.close();
  });

  it('replays create, patch and delete atomically without duplicates or changed completion metadata', async () => {
    const list = await defaultList();
    const id = crypto.randomUUID();
    const url = `${base}/${list.id}/tasks?operationId=${crypto.randomUUID()}&actorId=${owner.id}&taskId=${id}`;
    const first = await request('POST', url, { title: 'Offline' });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().task.id).toBe(id);
    expect((await request('POST', url, { title: 'Offline' })).body).toBe(first.body);
    expect((await request('POST', url, { title: 'Inne' })).statusCode).toBe(409);
    expect((await request('GET', `${base}/${list.id}/tasks?status=all`)).json().tasks).toHaveLength(1);
    const patchUrl = `/api/tasks/${id}?operationId=${crypto.randomUUID()}&actorId=${owner.id}`;
    const checked = await request('PATCH', patchUrl, { isDone: true });
    expect((await request('PATCH', patchUrl, { isDone: true })).body).toBe(checked.body);
    const deleteUrl = `/api/tasks/${id}?operationId=${crypto.randomUUID()}&actorId=${owner.id}`;
    expect((await request('DELETE', deleteUrl)).statusCode).toBe(200);
    expect((await request('DELETE', deleteUrl)).statusCode).toBe(200);
    expect((await request('GET', `${base}/${list.id}/tasks?status=all`)).json().tasks).toHaveLength(0);
  });

  it('checks current access before replaying a cached response with private task content', async () => {
    const list = await create([member.id]);
    const url = `${base}/${list.id}/tasks?operationId=${crypto.randomUUID()}&actorId=${member.id}&taskId=${crypto.randomUUID()}`;
    expect((await request('POST', url, { title: 'Prywatne' }, member)).statusCode).toBe(201);
    await request('PATCH', `${base}/${list.id}`, { memberIds: [] });
    const replay = await request('POST', url, { title: 'Prywatne' }, member);
    expect(replay.statusCode).toBe(404);
    expect(replay.body).not.toContain('Prywatne');
    expect((await request('POST', url, { title: 'Prywatne' }, admin)).statusCode).toBe(401);
  });

  it('rolls back the task when the durable operation record cannot be written', async () => {
    const list = await defaultList();
    database.sqlite.exec(
      "CREATE TRIGGER fail_task_operation BEFORE INSERT ON task_operations BEGIN SELECT RAISE(ABORT, 'test'); END",
    );
    const response = await request(
      'POST',
      `${base}/${list.id}/tasks?operationId=${crypto.randomUUID()}&taskId=${crypto.randomUUID()}`,
      { title: 'Rollback' },
    );
    expect(response.statusCode).toBe(500);
    expect((await request('GET', `${base}/${list.id}/tasks?status=all`)).json().tasks).toHaveLength(0);
  });

  async function addTask(listId: string, data: Record<string, unknown> = {}, user = owner): Promise<Task> {
    const response = await request('POST', `${base}/${listId}/tasks`, { title: 'Zadanie', ...data }, user);
    expect(response.statusCode, response.body).toBe(201);
    return taskResponseSchema.parse(response.json()).task;
  }
  async function readTasks(url: string, user = owner) {
    const response = await request('GET', url, undefined, user);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return tasksResponseSchema.parse(response.json()).tasks;
  }
  const taskUrl = (id: string) => `/api/tasks/${id}`;

  it('supports task CRUD by owners and shared members including children, with stable ordering and counts', async () => {
    const list = await create([member.id, child.id]);
    expect(list.openTaskCount).toBe(0);
    const first = await addTask(list.id, { title: '  Pierwsze  ', notes: '  Notatka  ' });
    const second = await addTask(list.id, { dueDate: '2028-05-01', dueTime: '12:30', assigneeId: owner.id }, child);
    expect(first).toMatchObject({
      title: 'Pierwsze',
      notes: 'Notatka',
      dueDate: null,
      dueTime: null,
      assigneeId: null,
      isDone: false,
      doneAt: null,
      doneBy: null,
      createdBy: owner.id,
      position: 0,
    });
    expect(second).toMatchObject({ position: 1, createdBy: child.id, assigneeId: owner.id });
    expect((await lists()).find((row) => row.id === list.id)?.openTaskCount).toBe(2);
    expect((await lists(member)).find((row) => row.id === list.id)?.openTaskCount).toBe(2);
    const update = await request(
      'PATCH',
      taskUrl(second.id),
      {
        title: 'Zmienione',
        notes: null,
        dueDate: null,
        dueTime: null,
        assigneeId: member.id,
        position: 0,
      },
      member,
    );
    expect(update.statusCode, update.body).toBe(200);
    expect(update.json().task).toMatchObject({
      title: 'Zmienione',
      notes: null,
      dueDate: null,
      dueTime: null,
      assigneeId: member.id,
    });
    await request('PATCH', taskUrl(first.id), { position: 2 });
    expect((await readTasks(`${base}/${list.id}/tasks`)).map((row) => row.id)).toEqual([second.id, first.id]);
    expect((await request('DELETE', taskUrl(first.id), {}, child)).json()).toEqual({ ok: true, deleted: true });
    expect((await lists()).find((row) => row.id === list.id)?.openTaskCount).toBe(1);
    expect((await request('PATCH', taskUrl(first.id), { title: 'Nie ma' })).statusCode).toBe(404);
    expect((await request('DELETE', taskUrl(first.id))).statusCode).toBe(404);
  });

  it('records the completing actor and time only on transition, filters status, and clears completion on reopen', async () => {
    const now = Date.parse('2028-05-01T10:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const list = await create([member.id]);
    const first = await addTask(list.id);
    const second = await addTask(list.id);
    const done = await request('PATCH', taskUrl(first.id), { isDone: true }, member);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().task).toMatchObject({ isDone: true, doneBy: member.id, doneAt: now });
    vi.mocked(Date.now).mockReturnValue(now + 60000);
    await request('PATCH', taskUrl(first.id), { isDone: true });
    await request('PATCH', taskUrl(first.id), { notes: 'Gotowe' });
    expect((await readTasks(`${base}/${list.id}/tasks?status=done`))[0]).toMatchObject({
      doneBy: member.id,
      doneAt: now,
    });
    expect((await readTasks(`${base}/${list.id}/tasks`)).map((row) => row.id)).toEqual([second.id]);
    expect((await readTasks(`${base}/${list.id}/tasks?status=open`)).map((row) => row.id)).toEqual([second.id]);
    expect(await readTasks(`${base}/${list.id}/tasks?status=all`)).toHaveLength(2);
    expect((await lists()).find((row) => row.id === list.id)?.openTaskCount).toBe(1);
    const reopened = await request('PATCH', taskUrl(first.id), { isDone: false });
    expect(reopened.json().task).toMatchObject({ isDone: false, doneBy: null, doneAt: null });
    expect(await readTasks(`${base}/${list.id}/tasks?status=done`)).toEqual([]);
    expect((await lists()).find((row) => row.id === list.id)?.openTaskCount).toBe(2);
  });

  it('rejects assignees outside the list atomically and accepts all list participants or null', async () => {
    const list = await create([child.id]);
    const task = await addTask(list.id, { assigneeId: child.id });
    for (const assigneeId of [admin.id, member.id, outsider.id, crypto.randomUUID()]) {
      const createResponse = await request('POST', `${base}/${list.id}/tasks`, { title: 'Błędne', assigneeId });
      expect(createResponse.statusCode).toBe(400);
      const update = await request('PATCH', taskUrl(task.id), { title: 'Błędne', assigneeId, isDone: true });
      expect(update.statusCode).toBe(400);
      expect(await readTasks(`${base}/${list.id}/tasks?status=all`)).toEqual([task]);
    }
    for (const assigneeId of [owner.id, child.id, null]) {
      const response = await request('PATCH', taskUrl(task.id), { assigneeId }, child);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().task.assigneeId).toBe(assigneeId);
    }
  });

  it('hides tasks and list task actions from nonmembers, including admins and other families', async () => {
    const list = await create();
    const task = await addTask(list.id);
    for (const user of [admin, member, child, outsider]) {
      for (const [method, url, data] of [
        ['GET', `${base}/${list.id}/tasks`, undefined],
        ['POST', `${base}/${list.id}/tasks`, { title: 'Nie wolno' }],
        ['PATCH', taskUrl(task.id), { title: 'Nie wolno' }],
        ['DELETE', taskUrl(task.id), {}],
      ] as const) {
        const hidden = await request(method, url, data, user);
        const absentUrl = url.replace(list.id, crypto.randomUUID()).replace(task.id, crypto.randomUUID());
        const absent = await request(method, absentUrl, data, user);
        expect(hidden.statusCode, hidden.body).toBe(404);
        expect(hidden.json()).toEqual(absent.json());
      }
      expect(await readTasks('/api/tasks/today', user)).toEqual([]);
    }
    expect(await readTasks(`${base}/${list.id}/tasks`)).toEqual([task]);
  });

  it('revokes task access immediately on leaving or removing sharing and clears stale assignments', async () => {
    for (const leave of [true, false]) {
      const list = await create([member.id]);
      const task = await addTask(list.id, { assigneeId: member.id, dueDate: '2020-01-01' }, member);
      if (leave) await request('POST', `${base}/${list.id}/leave`, {}, member);
      else await request('PATCH', `${base}/${list.id}`, { memberIds: [] });
      expect((await request('GET', `${base}/${list.id}/tasks`, undefined, member)).statusCode).toBe(404);
      expect((await request('PATCH', taskUrl(task.id), { isDone: true }, member)).statusCode).toBe(404);
      expect((await request('DELETE', taskUrl(task.id), {}, member)).statusCode).toBe(404);
      expect(await readTasks('/api/tasks/today', member)).toEqual([]);
      expect((await readTasks(`${base}/${list.id}/tasks`))[0]).toMatchObject({
        assigneeId: null,
        createdBy: member.id,
      });
    }
  });

  it.each([
    ['Europe/Warsaw', '2028-05-01T22:30:00Z', '2028-05-02'],
    ['America/Los_Angeles', '2028-05-02T01:30:00Z', '2028-05-01'],
  ])(
    'uses family timezone %s for today across all accessible lists, excluding done, undated and hidden tasks',
    async (timezone, now, today) => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse(now));
      database.db.update(schema.families).set({ timezone }).where(eq(schema.families.id, familyId)).run();
      const ownList = await defaultList();
      const shared = await create([owner.id], member);
      const privateList = await create([], member);
      const foreign = await create([], outsider);
      const overdue = await addTask(ownList.id, { dueDate: '2028-04-01' });
      const due = await addTask(shared.id, { dueDate: today, dueTime: '23:59', assigneeId: member.id }, member);
      await addTask(ownList.id, { dueDate: '2028-05-03' });
      await addTask(ownList.id);
      const done = await addTask(ownList.id, { dueDate: today });
      await request('PATCH', taskUrl(done.id), { isDone: true });
      await addTask(privateList.id, { dueDate: today }, member);
      await addTask(foreign.id, { dueDate: today }, outsider);
      expect((await readTasks('/api/tasks/today')).map((row) => row.id)).toEqual([overdue.id, due.id]);
      expect(await readTasks('/api/tasks/today', admin)).toEqual([]);
    },
  );

  it('rejects malformed task requests and server-managed fields without changing data', async () => {
    const list = await create();
    const task = await addTask(list.id, { dueDate: '2028-05-01', dueTime: '12:00' });
    for (const data of [
      { title: '' },
      { title: '  ' },
      { title: 'x'.repeat(201) },
      { title: 3 },
      { notes: 'x'.repeat(10001) },
      { dueDate: '2028-02-30' },
      { dueTime: '24:00' },
      { assigneeId: 'bad' },
      { createdBy: member.id },
      { doneBy: member.id },
      { doneAt: 1 },
      { listId: list.id },
      { familyId },
      { reminders: [{ type: 'offset', offsetValue: 0, offsetUnit: 'day', audience: 'family' }] },
    ]) {
      expect((await request('POST', `${base}/${list.id}/tasks`, { title: 'Nowe', ...data })).statusCode).toBe(400);
      expect((await request('PATCH', taskUrl(task.id), data)).statusCode).toBe(400);
    }
    for (const data of [
      {},
      { position: -1 },
      { position: 0.5 },
      { position: 2147483648 },
      { isDone: 'true' },
      { dueDate: null },
    ])
      expect((await request('PATCH', taskUrl(task.id), data)).statusCode).toBe(400);
    expect((await request('POST', `${base}/${list.id}/tasks`, { title: 'Nowe', dueTime: '12:00' })).statusCode).toBe(
      400,
    );
    expect((await request('GET', `${base}/${list.id}/tasks?status=bad`)).statusCode).toBe(400);
    expect((await request('GET', `${base}/${list.id}/tasks?status=open&status=done`)).statusCode).toBe(400);
    expect((await request('GET', `${base}/bad/tasks`)).statusCode).toBe(400);
    expect((await request('PATCH', '/api/tasks/bad', { title: 'Nowe' })).statusCode).toBe(400);
    expect((await request('DELETE', '/api/tasks/bad')).statusCode).toBe(400);
    expect(await readTasks(`${base}/${list.id}/tasks?status=all`)).toEqual([task]);
  });

  it('requires a session for every task endpoint', async () => {
    const id = crypto.randomUUID();
    for (const [method, url] of [
      ['GET', `${base}/${id}/tasks`],
      ['POST', `${base}/${id}/tasks`],
      ['PATCH', taskUrl(id)],
      ['DELETE', taskUrl(id)],
      ['GET', '/api/tasks/today'],
    ] as const)
      expect((await request(method, url, { title: 'Zadanie' }, { id: '', cookie: '' })).statusCode).toBe(401);
  });

  it('preserves task data with nullable user references when the completing member is deleted', async () => {
    const list = await create([member.id]);
    const task = await addTask(list.id, { assigneeId: member.id }, member);
    await request('PATCH', taskUrl(task.id), { isDone: true }, member);
    expect((await request('DELETE', `/api/members/${member.id}`, {}, admin)).statusCode).toBe(200);
    expect((await readTasks(`${base}/${list.id}/tasks?status=done`))[0]).toMatchObject({
      id: task.id,
      createdBy: null,
      assigneeId: null,
      doneBy: null,
      isDone: true,
      doneAt: expect.any(Number),
    });
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('requires a session on every endpoint', async () => {
    const id = crypto.randomUUID();
    for (const [method, url] of [
      ['GET', base],
      ['POST', base],
      ['PATCH', `${base}/${id}`],
      ['DELETE', `${base}/${id}`],
      ['POST', `${base}/${id}/leave`],
    ] as const) {
      expect((await request(method, url, { name: 'Lista' }, { id: '', cookie: '' })).statusCode).toBe(401);
    }
  });

  it('lazily creates one private default per user including children, also on repeated overlapping reads', async () => {
    expect(database.db.select().from(schema.taskLists).all()).toEqual([]);
    const results = await Promise.all([lists(child), lists(child), lists(owner), lists(admin)]);
    expect(results[0]).toEqual(results[1]);
    for (const [index, user] of [
      [0, child],
      [2, owner],
      [3, admin],
    ] as const) {
      expect(results[index]).toHaveLength(1);
      expect(results[index][0]).toMatchObject({
        name: 'Moje zadania',
        isDefault: true,
        ownerId: user.id,
        memberIds: [],
      });
    }
    expect(new Set(results.flat().map((list) => list.id)).size).toBe(3);
    expect(() =>
      database.db
        .insert(schema.taskLists)
        .values({
          id: crypto.randomUUID(),
          familyId,
          ownerId: child.id,
          name: 'Duplikat',
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it('allows children to create and own lists and normalizes duplicate/self memberships', async () => {
    const response = await request(
      'POST',
      base,
      { name: '  Nauka  ', memberIds: [owner.id, child.id, owner.id] },
      child,
    );
    expect(response.statusCode, response.body).toBe(201);
    const list: TaskList = response.json().list;
    expect(list).toMatchObject({ name: 'Nauka', ownerId: child.id, isDefault: false, memberIds: [owner.id] });
    expect((await lists(child))[0]).toMatchObject({ name: 'Moje zadania', ownerId: child.id });
    expect((await lists(owner)).map((row) => row.id)).toContain(list.id);
    expect((await lists(admin)).map((row) => row.id)).not.toContain(list.id);
  });

  it('returns only owned/shared lists, with the current user default first and a common access service', async () => {
    const shared = await create([member.id]);
    const privateList = await create();
    const otherFamilyList = await create([], outsider);
    const visible = await lists(member);
    expect(visible[0]).toMatchObject({ ownerId: member.id, isDefault: true });
    expect(visible.map((row) => row.id)).toEqual([visible[0]!.id, shared.id]);
    const service = createTaskListService(database);
    expect(service.canAccessList(familyId, owner.id, privateList.id)).toBe(true);
    expect(service.canAccessList(familyId, member.id, shared.id)).toBe(true);
    expect(service.canAccessList(familyId, admin.id, privateList.id)).toBe(false);
    expect(service.canAccessList(familyId, owner.id, otherFamilyList.id)).toBe(false);
  });

  it('hides private lists from everyone else, including the family admin, on all list actions', async () => {
    const list = await create();
    for (const user of [admin, member, child, outsider]) {
      expect((await lists(user)).map((row) => row.id)).not.toContain(list.id);
      for (const [method, url] of [
        ['PATCH', `${base}/${list.id}`],
        ['DELETE', `${base}/${list.id}`],
        ['POST', `${base}/${list.id}/leave`],
      ] as const) {
        const hidden = await request(method, url, { name: 'Zmiana', memberIds: [user.id] }, user);
        const absent = await request(method, url.replace(list.id, crypto.randomUUID()), { name: 'Zmiana' }, user);
        expect(hidden.statusCode).toBe(404);
        expect(hidden.json()).toEqual(absent.json());
      }
    }
  });

  it('forbids members including admins and children from renaming, sharing and deleting', async () => {
    const list = await create([admin.id, member.id, child.id]);
    for (const user of [admin, member, child]) {
      for (const data of [{ name: 'Zmieniona' }, { memberIds: [] }])
        expect((await request('PATCH', `${base}/${list.id}`, data, user)).statusCode).toBe(403);
      expect((await request('DELETE', `${base}/${list.id}`, {}, user)).statusCode).toBe(403);
    }
    expect((await lists())[1]).toEqual(list);
  });

  it('lets the owner rename and replace sharing, revoking access immediately and clearing removed assignments', async () => {
    const list = await create([member.id]);
    const taskId = task(list.id, member.id);
    const response = await request('PATCH', `${base}/${list.id}`, { name: 'Nowa nazwa', memberIds: [child.id] });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().list).toMatchObject({
      id: list.id,
      ownerId: owner.id,
      name: 'Nowa nazwa',
      memberIds: [child.id],
    });
    expect((await lists(member)).map((row) => row.id)).not.toContain(list.id);
    expect((await lists(child)).map((row) => row.id)).toContain(list.id);
    expect((await request('PATCH', `${base}/${list.id}`, { name: 'Zła zmiana' }, member)).statusCode).toBe(404);
    expect(database.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()).toMatchObject({
      assigneeId: null,
    });
  });

  it('does not change sharing when only the name is patched', async () => {
    const list = await create([member.id]);
    const response = await request('PATCH', `${base}/${list.id}`, { name: 'Nowa' });
    expect(response.json().list).toMatchObject({ name: 'Nowa', memberIds: [member.id] });
  });

  it('protects default lists while allowing their owner to rename and share them', async () => {
    const list = await defaultList();
    expect((await request('DELETE', `${base}/${list.id}`)).statusCode).toBe(400);
    const changed = await request('PATCH', `${base}/${list.id}`, { name: 'Osobiste', memberIds: [child.id] });
    expect(changed.json().list).toMatchObject({ isDefault: true, name: 'Osobiste', memberIds: [child.id] });
    expect((await request('DELETE', `${base}/${list.id}`, {}, child)).statusCode).toBe(403);
    expect((await lists()).filter((row) => row.isDefault)).toHaveLength(1);
  });

  it('lets members leave, including the last member, but never the owner', async () => {
    const list = await create([child.id]);
    const taskId = task(list.id, child.id);
    expect((await request('POST', `${base}/${list.id}/leave`)).statusCode).toBe(403);
    const response = await request('POST', `${base}/${list.id}/leave`, {}, child);
    expect(response.json()).toEqual({ ok: true, left: true });
    expect((await lists(child)).map((row) => row.id)).not.toContain(list.id);
    expect((await lists())[1]).toMatchObject({ id: list.id, memberIds: [] });
    expect((await request('POST', `${base}/${list.id}/leave`, {}, child)).statusCode).toBe(404);
    expect(database.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()?.assigneeId).toBeNull();
  });

  it('deletes a custom list with its memberships and tasks', async () => {
    const list = await create([member.id]);
    task(list.id);
    expect((await request('DELETE', `${base}/${list.id}`)).json()).toEqual({ ok: true, deleted: true });
    expect(database.db.select().from(schema.tasks).all()).toEqual([]);
    expect(database.db.select().from(schema.taskListMembers).all()).toEqual([]);
    expect((await lists()).map((row) => row.id)).not.toContain(list.id);
    expect((await request('DELETE', `${base}/${list.id}`)).statusCode).toBe(404);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('rejects invalid list bodies, identifiers and privileged fields', async () => {
    const list = await create();
    for (const payload of [
      { name: '' },
      { name: '  ' },
      { name: 'x'.repeat(201) },
      { name: 2 },
      { name: 'Lista', memberIds: ['bad'] },
      { name: 'Lista', isDefault: true },
      { name: 'Lista', ownerId: member.id },
      { name: 'Lista', familyId: crypto.randomUUID() },
    ]) {
      expect((await request('POST', base, payload)).statusCode).toBe(400);
      expect((await request('PATCH', `${base}/${list.id}`, payload)).statusCode).toBe(400);
    }
    expect((await request('PATCH', `${base}/${list.id}`, {})).statusCode).toBe(400);
    expect((await request('PATCH', `${base}/${list.id}`, { memberIds: null })).statusCode).toBe(400);
    expect((await request('PATCH', `${base}/bad-id`, { name: 'Lista' })).statusCode).toBe(400);
  });

  it('rejects nonexistent and foreign members atomically on create and patch', async () => {
    const list = await create([member.id]);
    for (const id of [outsider.id, crypto.randomUUID()]) {
      const before = database.db.select().from(schema.taskLists).all();
      expect((await request('POST', base, { name: 'Błędna', memberIds: [child.id, id] })).statusCode).toBe(400);
      expect(
        (await request('PATCH', `${base}/${list.id}`, { name: 'Błędna', memberIds: [child.id, id] })).statusCode,
      ).toBe(400);
      expect(database.db.select().from(schema.taskLists).all()).toEqual(before);
      expect((await lists())[1]).toEqual(list);
    }
  });

  it('removes private lists and transfers shared lists including defaults to the first remaining member', async () => {
    const inheritedList = await defaultList();
    const memberDefault = await defaultList(member);
    await request('PATCH', `${base}/${inheritedList.id}`, { memberIds: [child.id, member.id] });
    const privateList = await create();
    const shared = await create([child.id]);
    task(privateList.id);
    const survivingTaskId = task(shared.id);
    const response = await request('DELETE', `/api/members/${owner.id}`, {}, admin);
    expect(response.statusCode, response.body).toBe(200);
    expect(database.db.select().from(schema.users).where(eq(schema.users.id, owner.id)).get()).toBeUndefined();
    expect(
      database.db.select().from(schema.taskLists).where(eq(schema.taskLists.id, privateList.id)).get(),
    ).toBeUndefined();
    expect(await lists(member)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: inheritedList.id, ownerId: member.id, isDefault: false, memberIds: [child.id] }),
        expect.objectContaining({ id: memberDefault.id, ownerId: member.id, isDefault: true }),
      ]),
    );
    expect(await lists(child)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: shared.id, ownerId: child.id, isDefault: false, memberIds: [] }),
      ]),
    );
    expect(database.db.select().from(schema.tasks).all()).toEqual([
      expect.objectContaining({ id: survivingTaskId, assigneeId: null, createdBy: null, doneBy: null }),
    ]);
    expect(database.db.select().from(schema.sessions).where(eq(schema.sessions.userId, owner.id)).all()).toEqual([]);
    expect((await request('GET', base)).statusCode).toBe(401);
    expect((await lists(admin)).map((row) => row.id)).not.toContain(shared.id);
    expect((await request('DELETE', `${base}/${inheritedList.id}`, {}, member)).statusCode).toBe(200);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('removes a deleted member from other lists while preserving their tasks and owner', async () => {
    const list = await create([member.id]);
    const id = task(list.id, member.id);
    const response = await request('DELETE', `/api/members/${member.id}`, {}, admin);
    expect(response.statusCode, response.body).toBe(200);
    expect((await lists())[1]).toMatchObject({ id: list.id, ownerId: owner.id, memberIds: [] });
    expect(database.db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()).toMatchObject({
      assigneeId: null,
      createdBy: null,
      doneBy: null,
    });
    expect(
      database.db.select().from(schema.taskListMembers).where(eq(schema.taskListMembers.userId, member.id)).all(),
    ).toEqual([]);
  });

  it('rolls ownership, private list deletion and sessions back when user deletion fails', async () => {
    const privateList = await create();
    const shared = await create([member.id]);
    database.sqlite.exec(
      `CREATE TRIGGER block_user_delete BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'blocked'); END`,
    );
    const response = await request('DELETE', `/api/members/${owner.id}`, {}, admin);
    expect(response.statusCode).toBe(500);
    expect(
      database.db.select().from(schema.taskLists).where(eq(schema.taskLists.id, privateList.id)).get(),
    ).toBeDefined();
    expect(database.db.select().from(schema.taskLists).where(eq(schema.taskLists.id, shared.id)).get()?.ownerId).toBe(
      owner.id,
    );
    expect(
      database.db
        .select()
        .from(schema.taskListMembers)
        .where(and(eq(schema.taskListMembers.listId, shared.id), eq(schema.taskListMembers.userId, member.id)))
        .get(),
    ).toBeDefined();
    expect((await request('GET', base)).statusCode).toBe(200);
  });

  it('does not touch lists for forbidden member deletion or attempts against another family', async () => {
    const list = await create([member.id]);
    expect((await request('DELETE', `/api/members/${owner.id}`, {}, member)).statusCode).toBe(403);
    expect((await request('DELETE', `/api/members/${owner.id}`, {}, outsider)).statusCode).toBe(404);
    expect((await request('DELETE', `/api/members/${admin.id}`, {}, admin)).statusCode).toBe(400);
    expect((await lists())[1]).toEqual(list);
  });
});
