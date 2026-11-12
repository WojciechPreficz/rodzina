// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp } from './app.js';
import { hashToken } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { families, sessions, users } from './db/schema.js';
import { createInitialContactGroups } from './modules/contacts/repository.js';

let database: ReturnType<typeof createDatabase>;
let app: Awaited<ReturnType<typeof buildApp>>;
let cookie: string;
let actorId: string;
let emailVerificationToken: string | null;

function createFamily() {
  const familyId = randomUUID();
  const userId = randomUUID();
  const token = randomUUID();
  database.db.insert(families).values({ id: familyId, name: 'Rodzina', joinCode: familyId, createdAt: 1 }).run();
  database.db
    .insert(users)
    .values({ id: userId, familyId, displayName: 'Admin', role: 'admin', createdAt: 1, updatedAt: 1 })
    .run();
  database.db
    .insert(sessions)
    .values({ id: hashToken(token), userId, expiresAt: Date.now() + 60_000, createdAt: 1 })
    .run();
  createInitialContactGroups(database, familyId, userId, 1);
  return { cookie: `sid=${token}`, userId };
}

beforeEach(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    RODZINA_DATABASE_PATH: ':memory:',
    RODZINA_SMTP_HOST: 'unused.example.com',
    RODZINA_SMTP_USER: 'test',
    RODZINA_SMTP_PASSWORD: 'test-only',
    RODZINA_MAIL_FROM: 'sender@example.com',
    RODZINA_MAX_FAMILY_EVENTS: '1',
    RODZINA_MAX_FAMILY_CONTACTS: '1',
    RODZINA_MAX_FAMILY_CONTACT_GROUPS: '5',
    RODZINA_MAX_FAMILY_SHOPPING_LISTS: '2',
    RODZINA_MAX_FAMILY_SHOPPING_ITEMS: '1',
    RODZINA_MAX_FAMILY_TASK_LISTS: '2',
    RODZINA_MAX_FAMILY_TASKS: '2',
    RODZINA_MAX_FAMILY_TASK_SERIES: '1',
    RODZINA_MAX_FAMILY_DOCUMENTS: '1',
    RODZINA_MAX_FAMILY_MEALS: '1',
    RODZINA_MAX_FAMILY_MEMBERS: '2',
  });
  database = createDatabase(config);
  migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
  ({ cookie, userId: actorId } = createFamily());
  emailVerificationToken = null;
  app = await buildApp(config, database, undefined, undefined, undefined, async (_config, mail) => {
    emailVerificationToken = new URLSearchParams(new URL(mail.link).hash.slice(1)).get('token');
  });
});

afterEach(async () => {
  await app?.close();
  database?.sqlite.close();
});

function request(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, data?: object, session = cookie) {
  return app.inject({
    method,
    url,
    headers: { cookie: session, host: 'localhost:3000', origin: 'http://localhost:3000' },
    ...(data ? { payload: data } : {}),
  });
}

function expectLimit(response: LightMyRequestResponse, label: string, limit: number) {
  expect(response.statusCode, response.body).toBe(409);
  expect(response.json()).toEqual({
    error: { code: 'FAMILY_RECORD_LIMIT', message: `Rodzina osiągnęła limit ${label} (${limit}).` },
  });
}

it('counts saved events and rolls back a recurring event split at the limit', async () => {
  const event = { title: 'Spotkanie', startDate: '2026-11-01', kind: 'single' };
  const recurring = await request('POST', '/api/events', { ...event, kind: 'recurring', rrule: 'FREQ=DAILY;COUNT=5' });
  expect(recurring.statusCode, recurring.body).toBe(201);
  const url = `/api/events/${recurring.json().event.id}`;
  expectLimit(await request('POST', '/api/events', event), 'wydarzeń', 1);
  expectLimit(
    await request('PATCH', `${url}?scope=following&occurrenceDate=2026-11-02`, { title: 'Zmiana' }),
    'wydarzeń',
    1,
  );
  expect((await request('GET', url)).json().event.rrule).toBe('FREQ=DAILY;COUNT=5');
  const imported = await request('POST', '/api/events/import', { items: [{ operationId: randomUUID(), event }] });
  expect(imported.json().results[0]).toMatchObject({ status: 'error', error: { code: 'FAMILY_RECORD_LIMIT' } });
  expect((await request('POST', '/api/events', event, createFamily().cookie)).statusCode).toBe(201);
  expect((await request('DELETE', url)).statusCode).toBe(200);
  expect((await request('POST', '/api/events', event)).statusCode).toBe(201);
});

it('enforces contact and group limits and allows updates at capacity', async () => {
  const group = await request('POST', '/api/contact-groups', { name: 'Lekarze' });
  expect(group.statusCode, group.body).toBe(201);
  expectLimit(await request('POST', '/api/contact-groups', { name: 'Sąsiedzi' }), 'grup kontaktów', 5);
  const contact = await request('POST', '/api/contacts', { name: 'Anna', groupId: group.json().group.id });
  expect(contact.statusCode, contact.body).toBe(201);
  expectLimit(await request('POST', '/api/contacts', { name: 'Kamil' }), 'kontaktów', 1);
  expect((await request('PATCH', `/api/contacts/${contact.json().contact.id}`, { name: 'Ania' })).statusCode).toBe(200);
});

it('shares the shopping item limit across lists and rolls back meal export at capacity', async () => {
  const first = await request('POST', '/api/shopping/lists', { name: 'Pierwsza' });
  const second = await request('POST', '/api/shopping/lists', { name: 'Druga' });
  expect(first.statusCode, first.body).toBe(201);
  expect(second.statusCode, second.body).toBe(201);
  expectLimit(await request('POST', '/api/shopping/lists', { name: 'Trzecia' }), 'list zakupów', 2);
  const items = `/api/shopping/lists/${second.json().list.id}/items`;
  expect(
    (await request('POST', `/api/shopping/lists/${first.json().list.id}/items`, { name: 'Woda' })).statusCode,
  ).toBe(201);
  expectLimit(await request('POST', items, { name: 'Chleb' }), 'pozycji zakupów', 1);
  const date = '2026-10-19';
  expect(
    (await request('PUT', `/api/meals/${date}/dinner`, { title: 'Zupa', ingredients: [{ name: 'Marchew' }] }))
      .statusCode,
  ).toBe(200);
  expectLimit(
    await request('POST', `/api/meals/to-shopping-list?operationId=${randomUUID()}`, {
      weekStart: date,
      listId: second.json().list.id,
    }),
    'pozycji zakupów',
    1,
  );
  expect((await request('GET', items)).json().items).toEqual([]);
});

it('counts default task lists, tasks across lists, and rolls back recurrence at capacity', async () => {
  const list = await request('POST', '/api/tasks/lists', { name: 'Lista' });
  expect(list.statusCode, list.body).toBe(201);
  expectLimit(await request('POST', '/api/tasks/lists', { name: 'Druga' }), 'list zadań', 2);
  const lists = await request('GET', '/api/tasks/lists');
  const defaultList = lists.json().lists.find((entry: { isDefault: boolean }) => entry.isDefault);
  const first = await request('POST', `/api/tasks/lists/${defaultList.id}/tasks`, { title: 'Pierwsze' });
  const second = await request('POST', `/api/tasks/lists/${list.json().list.id}/tasks`, { title: 'Drugie' });
  expect(first.statusCode, first.body).toBe(201);
  expect(second.statusCode, second.body).toBe(201);
  expectLimit(await request('POST', `/api/tasks/lists/${defaultList.id}/tasks`, { title: 'Trzecie' }), 'zadań', 2);
  const series = {
    rule: {
      mode: 'schedule',
      unit: 'day',
      interval: 1,
      startDate: '2026-10-01',
      time: '15:00',
      timezone: 'Europe/Warsaw',
      endDate: null,
    },
    template: { title: 'Wzorzec', notes: null, assigneeId: null, reminders: [] },
    expectedVersion: 0,
    expectedOccurrenceVersion: 0,
  };
  const firstUrl = `/api/tasks/${first.json().task.id}`;
  const configured = await request('POST', `${firstUrl}/recurrence?operationId=${randomUUID()}`, series);
  expect(configured.statusCode, configured.body).toBe(201);
  expectLimit(
    await request('POST', `/api/tasks/${second.json().task.id}/recurrence?operationId=${randomUUID()}`, series),
    'serii zadań',
    1,
  );
  expectLimit(await request('PATCH', firstUrl, { isDone: true }), 'zadań', 2);
  const tasks = await request('GET', `/api/tasks/lists/${defaultList.id}/tasks?status=all`);
  expect(tasks.json().tasks).toMatchObject([{ id: first.json().task.id, isDone: false }]);
});

it('enforces document and meal quotas and still allows updating existing records', async () => {
  const data = { type: 'passport', label: 'Paszport', expiresOn: '2028-05-01' };
  const document = await request('POST', '/api/documents', data);
  expect(document.statusCode, document.body).toBe(201);
  expectLimit(await request('POST', '/api/documents', data), 'dokumentów', 1);
  expect(
    (await request('PATCH', `/api/documents/${document.json().document.id}`, { label: 'Nowy opis' })).statusCode,
  ).toBe(200);
  const meal = { title: 'Zupa', ingredients: [] };
  const date = '2026-10-19';
  expect((await request('PUT', `/api/meals/${date}/dinner`, meal)).statusCode).toBe(200);
  expect((await request('PUT', `/api/meals/${date}/dinner`, { ...meal, title: 'Ryż' })).statusCode).toBe(200);
  expectLimit(await request('PUT', '/api/meals/2026-10-20/dinner', meal), 'obiadów', 1);
  expectLimit(
    await request('POST', '/api/meals/copy-week', { fromWeekStart: date, toWeekStart: '2026-10-26', overwrite: false }),
    'obiadów',
    1,
  );
  expectLimit(
    await request('POST', `/api/meals/offline?operationId=${randomUUID()}&actorId=${actorId}`, {
      type: 'write',
      weekStart: date,
      byId: true,
      writes: [{ date: '2026-10-20', id: randomUUID(), expectedId: null, data: meal }],
    }),
    'obiadów',
    1,
  );
});

it('shares the member quota across child creation and invitation acceptance without consuming the invitation', async () => {
  expect((await request('POST', '/api/members/child', { displayName: 'Dziecko', pin: '1234' })).statusCode).toBe(201);
  expectLimit(
    await request('POST', '/api/members/child', { displayName: 'Drugie dziecko', pin: '4321' }),
    'domowników',
    2,
  );
  const invitation = await request('POST', '/api/invitations', { role: 'member' });
  expect(invitation.statusCode, invitation.body).toBe(200);
  const url = `/api/invitations/${invitation.json().token}`;
  const verification = await request('POST', `${url}/email-verification`, { email: 'gosc@example.com' }, '');
  expect(verification.statusCode, verification.body).toBe(202);
  expect(emailVerificationToken).toBeTruthy();
  expectLimit(
    await request(
      'POST',
      `${url}/accept`,
      { displayName: 'Gość', emailVerificationToken, password: 'password123' },
      '',
    ),
    'domowników',
    2,
  );
  expect((await request('GET', url, undefined, '')).statusCode).toBe(200);
});
