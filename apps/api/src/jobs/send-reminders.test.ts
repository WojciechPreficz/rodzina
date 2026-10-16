// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeNextFireAt, localDateTimeToUtc, type TimeReminder } from '@rodzina/shared';
import { loadTestConfig } from '../config.test-utils.js';
import { createDatabase } from '../db/client.js';
import {
  families,
  users,
  events,
  eventParticipants,
  eventExceptions,
  reminders,
  pushSubscriptions,
} from '../db/schema.js';
import { parseNowArgument, sendReminders } from './send-reminders.js';
import type { PushSender } from '../modules/push/sender.js';

const tz = 'Europe/Warsaw';
const utc = (date: string, time = '12:00') => localDateTimeToUtc(date, time, tz);
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const now = utc('2026-10-20', '16:45');
const offset = { type: 'offset', offsetValue: 15, offsetUnit: 'minute' } as const;

describe('reminder delivery job', () => {
  let directory: string;
  let database: ReturnType<typeof createDatabase>;
  const connections: ReturnType<typeof createDatabase>[] = [];
  const send = vi.fn<PushSender['send']>(async () => {});
  const log = vi.fn();
  function connect() {
    const connection = createDatabase(
      loadTestConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: path.join(directory, 'test.db') }),
    );
    connections.push(connection);
    return connection;
  }
  function addSubscription(userId: string, id = userId) {
    database.db
      .insert(pushSubscriptions)
      .values({ id, userId, endpoint: `https://push.example.com/${id}`, p256dh: 'key', auth: 'auth', createdAt: 0 })
      .run();
  }
  function seedReminder(data: TimeReminder = offset, fireAt = now) {
    database.db
      .insert(reminders)
      .values({
        id: 'reminder',
        familyId: 'family',
        eventId: 'event',
        ...data,
        audience: 'participants',
        createdBy: 'admin',
        nextFireAt: fireAt,
      })
      .run();
  }
  function row() {
    return database.db.select().from(reminders).get()!;
  }

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'rodzina-reminders-'));
    database = connect();
    migrate(database.db, { migrationsFolder });
    database.db.insert(families).values({ id: 'family', name: 'Rodzina', joinCode: '123456', createdAt: 0 }).run();
    database.db
      .insert(users)
      .values([
        { id: 'admin', familyId: 'family', displayName: 'Mama', role: 'admin', createdAt: 0, updatedAt: 0 },
        { id: 'member', familyId: 'family', displayName: 'Tata', role: 'member', createdAt: 0, updatedAt: 0 },
        { id: 'child', familyId: 'family', displayName: 'Zosia', role: 'child', createdAt: 0, updatedAt: 0 },
      ])
      .run();
    database.db
      .insert(events)
      .values({
        id: 'event',
        familyId: 'family',
        title: 'Basen',
        startDate: '2026-10-20',
        startTime: '17:00',
        durationMinutes: 60,
        datePrecision: 'day',
        kind: 'single',
        createdBy: 'child',
        createdAt: 0,
        updatedAt: 0,
      })
      .run();
    database.db.insert(eventParticipants).values({ eventId: 'event', userId: 'child' }).run();
    for (const id of ['admin', 'member', 'child']) addSubscription(id);
    send.mockReset().mockResolvedValue(undefined);
    log.mockReset();
  });
  afterEach(() => {
    for (const connection of connections.splice(0)) connection.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('does not send early; commits the reservation before sending, and never sends twice', async () => {
    seedReminder();
    await sendReminders(database, { send }, now - 1, log);
    expect(send).not.toHaveBeenCalled();
    send.mockImplementation(async () => {
      expect(database.sqlite.inTransaction).toBe(false);
      expect(row()).toMatchObject({ lastSentAt: now, nextFireAt: null });
    });
    await sendReminders(database, { send }, now, log);
    await sendReminders(database, { send }, now + 1, log);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual([
      expect.objectContaining({ userId: 'child' }),
      expect.objectContaining({
        title: 'Dziś 17:00: Basen (Zosia)',
        url: '/kalendarz/wydarzenie/event?data=2026-10-20',
      }),
    ]);
    expect(
      database.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, 'child')).get()?.lastSuccessAt,
    ).toBe(now);
  });

  it('reserves once across two connections while the first delivery is still in flight', async () => {
    seedReminder();
    const second = connect();
    let release!: () => void;
    send.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = sendReminders(database, { send }, now, log);
    const other = await sendReminders(second, { send }, now, log);
    expect(other.reserved).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('reserves once when two independent Node processes start against the same SQLite file', async () => {
    seedReminder();
    const code = `
      import { createDatabase } from ${JSON.stringify(new URL('../db/client.ts', import.meta.url).href)};
      import { loadTestConfig } from ${JSON.stringify(new URL('../config.test-utils.ts', import.meta.url).href)};
      import { sendReminders } from ${JSON.stringify(new URL('./send-reminders.ts', import.meta.url).href)};
      const db = createDatabase(loadTestConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: process.env.TEST_DATABASE }));
      try {
        await sendReminders(db, { send: async () => { console.log('DELIVERED'); await new Promise(resolve => setTimeout(resolve, 100)); } }, ${now}, () => {});
      } finally { db.sqlite.close(); }
    `;
    const run = () =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
          env: { ...process.env, TEST_DATABASE: path.join(directory, 'test.db') },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let errors = '';
        child.stdout.on('data', (chunk) => {
          output += chunk;
        });
        child.stderr.on('data', (chunk) => {
          errors += chunk;
        });
        child.once('error', reject);
        child.once('exit', (status) => (status === 0 ? resolve(output) : reject(new Error(errors))));
      });
    const outputs = await Promise.all([run(), run()]);
    expect(outputs.join('').match(/DELIVERED/g)).toHaveLength(1);
    expect(row()).toMatchObject({ nextFireAt: null, lastSentAt: now });
  }, 20000);

  it('rolls the whole reservation back if an update fails', async () => {
    seedReminder();
    database.db
      .insert(reminders)
      .values({ ...row(), id: 'second' })
      .run();
    database.sqlite.exec(
      "CREATE TRIGGER fail_reservation BEFORE UPDATE ON reminders WHEN NEW.id = 'second' BEGIN SELECT RAISE(ABORT, 'failure'); END",
    );
    await expect(sendReminders(database, { send }, now, log)).rejects.toThrow('failure');
    expect(
      database.db
        .select()
        .from(reminders)
        .all()
        .every((item) => item.lastSentAt === null && item.nextFireAt === now),
    ).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('advances recurrence across DST, sends each occurrence once and respects COUNT', async () => {
    database.db.update(events).set({ kind: 'recurring', rrule: 'FREQ=WEEKLY;COUNT=2' }).run();
    seedReminder();
    const next = utc('2026-10-27', '16:45');
    await sendReminders(database, { send }, now, log);
    expect(row().nextFireAt).toBe(next);
    await sendReminders(database, { send }, now, log);
    await sendReminders(database, { send }, next, log);
    expect(row().nextFireAt).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[1]).toMatchObject({ url: '/kalendarz/wydarzenie/event?data=2026-10-27' });
  });

  it('uses a moved occurrence time and title while retaining the original deep link', async () => {
    database.db.update(events).set({ kind: 'recurring', rrule: 'FREQ=WEEKLY;COUNT=2' }).run();
    database.db
      .insert(eventExceptions)
      .values({
        id: 'exception',
        eventId: 'event',
        originalDate: '2026-10-20',
        isCancelled: false,
        overrideStartDate: '2026-10-21',
        overrideStartTime: '18:00',
        overrideTitle: 'Inny basen',
      })
      .run();
    const fire = utc('2026-10-21', '17:45');
    seedReminder(offset, fire);
    await sendReminders(database, { send }, fire, log);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      title: 'Dziś 18:00: Inny basen (Zosia)',
      url: '/kalendarz/wydarzenie/event?data=2026-10-20',
    });
    expect(row().nextFireAt).toBe(utc('2026-10-27', '16:45'));
  });

  it.each([404, 410])('deletes subscriptions on %i and continues to other devices', async (statusCode) => {
    seedReminder();
    addSubscription('child', 'second-device');
    send.mockRejectedValueOnce({ statusCode });
    const result = await sendReminders(database, { send }, now, log);
    expect(result).toMatchObject({ removed: 1, sent: 1, failed: 0 });
    expect(database.db.select().from(pushSubscriptions).all()).toHaveLength(3);
  });

  it('retains subscriptions on transient failure, logs no secrets and does not retry the reservation', async () => {
    seedReminder();
    send.mockRejectedValue({ statusCode: 503, body: 'secret', endpoint: 'secret' });
    expect(await sendReminders(database, { send }, now, log)).toMatchObject({ failed: 1 });
    await sendReminders(database, { send }, now, log);
    expect(send).toHaveBeenCalledTimes(1);
    expect(database.db.select().from(pushSubscriptions).all()).toHaveLength(3);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });

  it('falls back to current adults when the creator was removed and participants are empty', async () => {
    seedReminder();
    database.db.delete(users).where(eq(users.id, 'child')).run();
    await sendReminders(database, { send }, now, log);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({ userId: 'admin' }),
      expect.objectContaining({ userId: 'member' }),
    ]);
    expect(database.db.select().from(pushSubscriptions).all()).toHaveLength(2);
  });

  it.each([
    [false, false, 2, true],
    [false, false, 2.001, false],
    [true, false, 12, true],
    [true, false, 12.001, false],
    [true, true, 2, true],
    [true, true, 2.001, false],
  ])('applies grace period: allDay=%s absolute=%s delay=%s hours', async (allDay, absolute, hours, delivered) => {
    if (allDay) database.db.update(events).set({ startTime: null, durationMinutes: null }).run();
    const fire = allDay ? utc('2026-10-20', '08:45') : now;
    seedReminder(absolute ? { type: 'absolute', remindAt: fire } : offset, fire);
    const delayed = fire + hours * 3600000;
    await sendReminders(database, { send }, delayed, log);
    expect(send).toHaveBeenCalledTimes(delivered ? 1 : 0);
    expect(row()).toMatchObject({ nextFireAt: null, lastSentAt: delayed });
    if (!delivered) expect(log).toHaveBeenCalledWith(expect.objectContaining({ reason: 'overdue' }));
  });

  it('skips missed cycles instead of sending a burst after an outage', async () => {
    database.db.update(events).set({ kind: 'recurring', rrule: 'FREQ=DAILY;COUNT=10' }).run();
    seedReminder();
    const delayed = utc('2026-10-24', '19:00');
    await sendReminders(database, { send }, delayed, log);
    expect(send).not.toHaveBeenCalled();
    expect(row()).toMatchObject({ lastSentAt: delayed, nextFireAt: utc('2026-10-25', '16:45') });
  });

  it('delivers month-precision distant deadlines at the 09:00 default', async () => {
    database.db
      .update(events)
      .set({
        title: 'USG nogi',
        kind: 'distant',
        startDate: '2028-05-01',
        datePrecision: 'month',
        startTime: null,
        durationMinutes: null,
      })
      .run();
    database.db.delete(eventParticipants).run();
    const data = { type: 'offset', offsetValue: 3, offsetUnit: 'month' } as const;
    const fire = utc('2028-02-01', '09:00');
    expect(computeNextFireAt(data, { ...database.db.select().from(events).get()! }, fire - 1, tz)).toBe(fire);
    seedReminder(data, fire);
    await sendReminders(database, { send }, fire + 11 * 3600000, log);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      title: 'Za 3 miesiące: USG nogi',
      url: '/kalendarz/wydarzenie/event?data=2028-05-01',
    });
  });

  it('never sends a reminder to another family', async () => {
    database.db.insert(families).values({ id: 'other', name: 'Obcy', joinCode: '654321', createdAt: 0 }).run();
    database.db
      .insert(users)
      .values({ id: 'outsider', familyId: 'other', displayName: 'Obcy', role: 'admin', createdAt: 0, updatedAt: 0 })
      .run();
    addSubscription('outsider');
    seedReminder();
    database.db.update(reminders).set({ familyId: 'other' }).run();
    await sendReminders(database, { send }, now, log);
    expect(send).not.toHaveBeenCalled();
    expect(row().nextFireAt).toBeNull();
  });

  it('enforces unique endpoints and user cascades', () => {
    expect(() =>
      database.db
        .insert(pushSubscriptions)
        .values({
          id: 'duplicate',
          userId: 'member',
          endpoint: 'https://push.example.com/child',
          p256dh: 'another-key',
          auth: 'another-auth',
          createdAt: 0,
        })
        .run(),
    ).toThrow();
    database.db.delete(users).where(eq(users.id, 'child')).run();
    expect(database.db.select().from(pushSubscriptions).all()).toHaveLength(2);
  });
});

describe('--now argument', () => {
  it('uses an explicit time independently from the host clock', () => {
    expect(parseNowArgument([], 123)).toBe(123);
    expect(parseNowArgument(['--now=2026-10-20T16:45:00+02:00'])).toBe(now);
    expect(parseNowArgument(['--now=2026-10-20T14:45:00.000Z'])).toBe(now);
  });
  it.each(['--now=no', '--now=2026-02-30T10:00:00Z', '--now=2026-10-20', '--now=2026-10-20T10:00:00', '--unknown'])(
    'rejects invalid input: %s',
    (arg) => {
      expect(() => parseNowArgument([arg])).toThrow();
    },
  );
  it('rejects duplicate flags', () => {
    expect(() => parseNowArgument(['--now=2026-10-20T10:00:00Z', '--now=2026-10-20T10:00:00Z'])).toThrow();
  });
});
