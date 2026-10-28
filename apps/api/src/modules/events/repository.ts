import crypto from 'node:crypto';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import type { CalendarEvent, EventData } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { events, eventParticipants, eventExceptions, families, users, reminders } from '../../db/schema.js';
import { createReminderRepository } from '../reminders/repository.js';

export function createEventRepository(database: DatabaseConnection) {
  const db = database.db;
  const reminderRepository = createReminderRepository(database);
  function exceptions(familyId: string, eventId: string) {
    return db
      .select({ exception: eventExceptions })
      .from(eventExceptions)
      .innerJoin(events, eq(events.id, eventExceptions.eventId))
      .where(and(eq(events.familyId, familyId), eq(events.id, eventId)))
      .orderBy(asc(eventExceptions.originalDate))
      .all()
      .map(({ exception }) => exception);
  }
  function participants(familyId: string, eventId: string) {
    return db
      .select({ id: users.id, displayName: users.displayName, color: users.color })
      .from(eventParticipants)
      .innerJoin(users, eq(eventParticipants.userId, users.id))
      .where(and(eq(eventParticipants.eventId, eventId), eq(users.familyId, familyId)))
      .orderBy(asc(users.createdAt), asc(users.id))
      .all();
  }
  function find(familyId: string, id: string): CalendarEvent | undefined {
    const event = db
      .select()
      .from(events)
      .where(and(eq(events.familyId, familyId), eq(events.id, id)))
      .get();
    return event
      ? {
          ...event,
          participants: participants(familyId, id),
          reminders: reminderRepository.list(familyId, id),
          exceptions: exceptions(familyId, id),
        }
      : undefined;
  }
  function validParticipants(familyId: string, ids: string[]): boolean {
    return (
      ids.length === 0 ||
      db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.familyId, familyId), inArray(users.id, ids)))
        .all().length === ids.length
    );
  }
  function create(familyId: string, createdBy: string, data: EventData): CalendarEvent {
    const id = crypto.randomUUID();
    const now = Date.now();
    const { participantIds, reminders: sharedReminders, ...fields } = data;
    db.transaction((tx) => {
      tx.insert(events)
        .values({ ...fields, id, familyId, createdBy, createdAt: now, updatedAt: now })
        .run();
      if (participantIds.length)
        tx.insert(eventParticipants)
          .values(participantIds.map((userId) => ({ eventId: id, userId })))
          .run();
      reminderRepository.saveEvent(familyId, { ...fields, id }, createdBy, sharedReminders, timezone(familyId), now);
    });
    return find(familyId, id)!;
  }
  function update(familyId: string, id: string, data: EventData, actorId: string): CalendarEvent {
    const { participantIds, reminders: sharedReminders, ...fields } = data;
    const now = Date.now();
    db.transaction((tx) => {
      tx.update(events)
        .set({ ...fields, updatedAt: now })
        .where(and(eq(events.familyId, familyId), eq(events.id, id)))
        .run();
      tx.delete(eventParticipants).where(eq(eventParticipants.eventId, id)).run();
      if (participantIds.length)
        tx.insert(eventParticipants)
          .values(participantIds.map((userId) => ({ eventId: id, userId })))
          .run();
      reminderRepository.saveEvent(familyId, find(familyId, id)!, actorId, sharedReminders, timezone(familyId), now);
    });
    return find(familyId, id)!;
  }
  function remove(familyId: string, id: string) {
    db.delete(events)
      .where(and(eq(events.familyId, familyId), eq(events.id, id)))
      .run();
  }
  function list(familyId: string, userId?: string): CalendarEvent[] {
    const rows = userId
      ? db
          .select({ event: events })
          .from(events)
          .innerJoin(eventParticipants, eq(events.id, eventParticipants.eventId))
          .where(and(eq(events.familyId, familyId), eq(eventParticipants.userId, userId)))
          .all()
          .map(({ event }) => event)
      : db.select().from(events).where(eq(events.familyId, familyId)).all();
    return hydrate(familyId, rows);
  }
  function hydrate(familyId: string, rows: (typeof events.$inferSelect)[]): CalendarEvent[] {
    const shared = reminderRepository.listMany(
      familyId,
      'eventId',
      rows.map((event) => event.id),
    );
    const people = new Map<string, CalendarEvent['participants']>();
    const overrides = new Map<string, CalendarEvent['exceptions']>();
    for (let offset = 0; offset < rows.length; offset += 400) {
      const ids = rows.slice(offset, offset + 400).map((event) => event.id);
      const participants = db
        .select({ eventId: events.id, id: users.id, displayName: users.displayName, color: users.color })
        .from(eventParticipants)
        .innerJoin(events, eq(events.id, eventParticipants.eventId))
        .innerJoin(users, eq(users.id, eventParticipants.userId))
        .where(and(eq(events.familyId, familyId), eq(users.familyId, familyId), inArray(events.id, ids)))
        .orderBy(asc(users.createdAt), asc(users.id))
        .all();
      for (const { eventId, ...person } of participants) {
        if (!people.has(eventId)) people.set(eventId, []);
        people.get(eventId)!.push(person);
      }
      const exceptions = db
        .select({ exception: eventExceptions })
        .from(eventExceptions)
        .innerJoin(events, eq(events.id, eventExceptions.eventId))
        .where(and(eq(events.familyId, familyId), inArray(events.id, ids)))
        .orderBy(asc(eventExceptions.originalDate))
        .all();
      for (const { exception } of exceptions) {
        if (!overrides.has(exception.eventId)) overrides.set(exception.eventId, []);
        overrides.get(exception.eventId)!.push(exception);
      }
    }
    return rows.map((event) => ({
      ...event,
      participants: people.get(event.id) ?? [],
      reminders: shared.get(event.id) ?? [],
      exceptions: overrides.get(event.id) ?? [],
    }));
  }
  function upcomingDistant(familyId: string, today: string): CalendarEvent[] {
    // A month-precision deadline remains upcoming throughout that month.
    return hydrate(
      familyId,
      db
        .select()
        .from(events)
        .where(
          and(
            eq(events.familyId, familyId),
            eq(events.kind, 'distant'),
            gte(events.startDate, `${today.slice(0, 7)}-01`),
          ),
        )
        .orderBy(asc(events.startDate), asc(events.id))
        .all()
        .filter((event) => event.datePrecision === 'month' || event.startDate >= today),
    );
  }
  function timezone(familyId: string): string {
    return db.select({ timezone: families.timezone }).from(families).where(eq(families.id, familyId)).get()!.timezone;
  }
  function saveException(familyId: string, event: CalendarEvent, originalDate: string, data?: EventData) {
    db.transaction(() => {
      const row = {
        eventId: event.id,
        originalDate,
        isCancelled: data === undefined,
        overrideStartDate: data?.startDate ?? null,
        overrideStartTime: data?.startTime ?? null,
        overrideDurationMinutes: data?.durationMinutes ?? null,
        overrideTitle: data?.title ?? null,
      };
      db.insert(eventExceptions)
        .values({ id: crypto.randomUUID(), ...row })
        .onConflictDoUpdate({ target: [eventExceptions.eventId, eventExceptions.originalDate], set: row })
        .run();
      db.update(events).set({ updatedAt: Date.now() }).where(eq(events.id, event.id)).run();
      reminderRepository.saveEvent(familyId, find(familyId, event.id)!, '', undefined, timezone(familyId), Date.now());
    });
    return find(familyId, event.id)!;
  }
  function split(
    familyId: string,
    event: CalendarEvent,
    date: string,
    previousRule: string,
    data?: EventData,
    actorId = '',
  ) {
    return db.transaction(() => {
      const now = Date.now();
      const futureExceptions = event.exceptions.filter((exception) => exception.originalDate >= date);
      db.update(events)
        .set({ rrule: previousRule, updatedAt: now })
        .where(and(eq(events.familyId, familyId), eq(events.id, event.id)))
        .run();
      db.delete(eventExceptions)
        .where(and(eq(eventExceptions.eventId, event.id), gte(eventExceptions.originalDate, date)))
        .run();
      let next: CalendarEvent | undefined;
      if (data) {
        // Create without new reminders, then copy shared rows and transfer personal rows.
        next = create(familyId, actorId, { ...data, reminders: undefined });
        db.update(events).set({ createdBy: event.createdBy }).where(eq(events.id, next.id)).run();
        const rows = db
          .select()
          .from(reminders)
          .where(and(eq(reminders.familyId, familyId), eq(reminders.eventId, event.id)))
          .all();
        for (const row of rows) {
          if (row.audience === 'user') {
            db.update(reminders).set({ eventId: next.id }).where(eq(reminders.id, row.id)).run();
          } else {
            db.insert(reminders)
              .values({ ...row, id: crypto.randomUUID(), eventId: next.id })
              .run();
          }
        }
        // Existing exceptions retain their original-date identity if the future schedule is unchanged.
        const schedule = (rule: string | null) =>
          rule
            ?.replace(/^RRULE:/, '')
            .split(';')
            .filter((part) => !/^(COUNT|UNTIL)=/.test(part))
            .join(';');
        if (data.startDate === date && schedule(data.rrule) === schedule(event.rrule)) {
          for (const exception of futureExceptions) {
            db.insert(eventExceptions)
              .values({ ...exception, eventId: next.id })
              .run();
          }
        }
        reminderRepository.saveEvent(
          familyId,
          find(familyId, next.id)!,
          actorId,
          data.reminders,
          timezone(familyId),
          now,
        );
        next = find(familyId, next.id)!;
      }
      reminderRepository.saveEvent(familyId, find(familyId, event.id)!, actorId, undefined, timezone(familyId), now);
      return next;
    });
  }
  return { find, validParticipants, create, update, remove, list, upcomingDistant, timezone, saveException, split };
}
