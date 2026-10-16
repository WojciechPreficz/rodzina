import { pathToFileURL } from 'node:url';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { computeNextEventReminder, computeNextFireAt, localDateTimeToUtc, type TimeReminder } from '@rodzina/shared';
import { loadConfig } from '../config.js';
import { createDatabase, type DatabaseConnection } from '../db/client.js';
import { reminders, users, pushSubscriptions } from '../db/schema.js';
import { createEventRepository } from '../modules/events/repository.js';
import { buildReminderPayload, resolveRecipients } from '../modules/reminders/delivery.js';
import { createPushSender, type PushSender } from '../modules/push/sender.js';

type JobLogger = (entry: Record<string, string | number>) => void;
const stdout: JobLogger = (entry) => console.log(JSON.stringify(entry));
const HOUR = 3600000;

export function parseNowArgument(args: string[], now = Date.now()): number {
  if (!args.length) return now;
  if (
    args.length !== 1 ||
    !/^--now=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(args[0]!)
  ) {
    throw new Error('Użyj opcjonalnej flagi --now=<ISO z godziną i strefą>.');
  }
  const iso = args[0]!.slice('--now='.length);
  const value = Date.parse(iso);
  // Date.parse normalizes impossible days such as February 30.
  const date = iso.slice(0, 10);
  if (!Number.isFinite(value) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('Niepoprawny czas w --now.');
  }
  return value;
}

/** Reserve synchronously before the first network operation; never hold a lock during delivery. */
export async function sendReminders(
  database: DatabaseConnection,
  sender: PushSender,
  now = Date.now(),
  log: JobLogger = stdout,
) {
  if (!Number.isSafeInteger(now)) throw new RangeError('Expected a UTC millisecond timestamp');
  const repository = createEventRepository(database);
  const reserved = database.sqlite
    .transaction(() => {
      const due = database.db.select().from(reminders).where(lte(reminders.nextFireAt, now)).all();
      return due.map((reminder) => {
        const event = reminder.eventId ? repository.find(reminder.familyId, reminder.eventId) : undefined;
        const tz = event ? repository.timezone(reminder.familyId) : 'Europe/Warsaw';
        const data: TimeReminder =
          reminder.type === 'offset'
            ? { type: 'offset', offsetValue: reminder.offsetValue!, offsetUnit: reminder.offsetUnit! }
            : { type: 'absolute', remindAt: reminder.remindAt! };
        const nextFireAt = event ? computeNextFireAt(data, event, now, tz) : null;
        database.db.update(reminders).set({ lastSentAt: now, nextFireAt }).where(eq(reminders.id, reminder.id)).run();
        if (!event) return { reminder, reason: 'missing_source' as const };
        const zeroOffset = { type: 'offset', offsetValue: 0, offsetUnit: 'minute' } as const;
        const occurrence =
          data.type === 'offset'
            ? computeNextEventReminder(data, event, reminder.nextFireAt! - 1, tz)
            : (computeNextEventReminder(zeroOffset, event, reminder.remindAt! - 1, tz) ??
              computeNextEventReminder(zeroOffset, event, localDateTimeToUtc(event.startDate, '00:00', tz) - 1, tz));
        if (!occurrence || (data.type === 'offset' && occurrence.fireAt !== reminder.nextFireAt)) {
          return { reminder, reason: 'missing_occurrence' as const };
        }
        // Only offsets calculated from the 09:00 default receive the wider grace period.
        const grace = data.type === 'offset' && occurrence.allDay ? 12 * HOUR : 2 * HOUR;
        if (now - reminder.nextFireAt! > grace) return { reminder, reason: 'overdue' as const };
        return { reminder, event, tz, occurrenceDate: occurrence.occurrenceDate };
      });
    })
    .immediate();

  const result = { reserved: reserved.length, sent: 0, failed: 0, removed: 0, skipped: 0 };
  for (const item of reserved) {
    const reminderId = item.reminder.id;
    if ('reason' in item) {
      result.skipped++;
      log({ event: 'reminder_skipped', reminderId, reason: item.reason! });
      continue;
    }
    const members = database.db.select().from(users).where(eq(users.familyId, item.reminder.familyId)).all();
    const source = { event: item.event, members };
    const recipients = resolveRecipients(item.reminder, source);
    const subscriptions = recipients.length
      ? database.db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, recipients)).all()
      : [];
    if (!subscriptions.length) {
      result.skipped++;
      log({ event: 'reminder_skipped', reminderId, reason: recipients.length ? 'no_subscriptions' : 'no_recipients' });
      continue;
    }
    const payload = buildReminderPayload(source, item.occurrenceDate, now, item.tz);
    for (const subscription of subscriptions) {
      // A subscription may be replaced or removed while an earlier send is in flight.
      const unchanged = and(
        eq(pushSubscriptions.id, subscription.id),
        eq(pushSubscriptions.userId, subscription.userId),
        eq(pushSubscriptions.endpoint, subscription.endpoint),
        eq(pushSubscriptions.p256dh, subscription.p256dh),
        eq(pushSubscriptions.auth, subscription.auth),
      );
      if (!database.db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(unchanged).get()) continue;
      try {
        await sender.send(subscription, payload);
        database.db.update(pushSubscriptions).set({ lastSuccessAt: now }).where(unchanged).run();
        result.sent++;
        log({ event: 'push_sent', reminderId, subscriptionId: subscription.id });
      } catch (error) {
        const status =
          typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
            ? error.statusCode
            : 0;
        if (status === 404 || status === 410) {
          result.removed += database.db.delete(pushSubscriptions).where(unchanged).run().changes;
          log({ event: 'push_subscription_removed', reminderId, subscriptionId: subscription.id, status });
        } else {
          result.failed++;
          // Provider errors may contain endpoints, keys or payloads; do not log them.
          log({ event: 'push_failed', reminderId, subscriptionId: subscription.id, status });
        }
      }
    }
  }
  log({ event: 'reminders_finished', now, ...result });
  return result;
}

export async function runSendReminders(args = process.argv.slice(2)): Promise<void> {
  const now = parseNowArgument(args);
  const config = loadConfig();
  const database = createDatabase(config);
  try {
    const result = await sendReminders(database, createPushSender(config), now);
    if (result.failed) process.exitCode = 1;
  } finally {
    database.sqlite.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runSendReminders().catch(() => {
    stdout({ event: 'reminders_failed', reason: 'Sprawdź konfigurację, migracje i flagę --now.' });
    process.exitCode = 1;
  });
}
