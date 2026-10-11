import crypto from 'node:crypto';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import type { CalendarEvent, EventData } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { events, eventParticipants, families, users } from '../../db/schema.js';

export function createEventRepository(database: DatabaseConnection) {
  const db = database.db;
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
    return event ? { ...event, participants: participants(familyId, id) } : undefined;
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
    const { participantIds, ...fields } = data;
    db.transaction((tx) => {
      tx.insert(events)
        .values({ ...fields, id, familyId, createdBy, createdAt: now, updatedAt: now })
        .run();
      if (participantIds.length)
        tx.insert(eventParticipants)
          .values(participantIds.map((userId) => ({ eventId: id, userId })))
          .run();
    });
    return find(familyId, id)!;
  }
  function update(familyId: string, id: string, data: EventData): CalendarEvent {
    const { participantIds, ...fields } = data;
    db.transaction((tx) => {
      tx.update(events)
        .set({ ...fields, updatedAt: Date.now() })
        .where(and(eq(events.familyId, familyId), eq(events.id, id)))
        .run();
      tx.delete(eventParticipants).where(eq(eventParticipants.eventId, id)).run();
      if (participantIds.length)
        tx.insert(eventParticipants)
          .values(participantIds.map((userId) => ({ eventId: id, userId })))
          .run();
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
    return rows.map((event) => ({ ...event, participants: participants(familyId, event.id) }));
  }
  function upcomingDistant(familyId: string, today: string): CalendarEvent[] {
    // A month-precision deadline remains upcoming throughout that month.
    return db
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
      .filter((event) => event.datePrecision === 'month' || event.startDate >= today)
      .map((event) => ({ ...event, participants: participants(familyId, event.id) }));
  }
  function timezone(familyId: string): string {
    return db.select({ timezone: families.timezone }).from(families).where(eq(families.id, familyId)).get()!.timezone;
  }
  return { find, validParticipants, create, update, remove, list, upcomingDistant, timezone };
}
