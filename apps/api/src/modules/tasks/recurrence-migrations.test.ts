// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

it('preserves one-off tasks and enforces series membership, unique successors and atomic activation', () => {
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
  const oldMigrations = mkdtempSync(path.join(tmpdir(), 'rodzina-before-recurrence-'));
  const database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
  const { db, sqlite } = database;
  try {
    sqlite.pragma('foreign_keys = ON');
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 28);
    mkdirSync(path.join(oldMigrations, 'meta'));
    writeFileSync(path.join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
    migrate(db, { migrationsFolder: oldMigrations });
    const familyId = randomUUID(),
      userId = randomUUID(),
      listId = randomUUID(),
      seriesId = randomUUID(),
      historicalUserId = randomUUID();
    db.insert(schema.families).values({ id: familyId, name: 'Test', joinCode: familyId, createdAt: 1 }).run();
    db.insert(schema.users)
      .values({ id: userId, familyId, displayName: 'Test', role: 'child', createdAt: 1, updatedAt: 1 })
      .run();
    db.insert(schema.users)
      .values({
        id: historicalUserId,
        familyId,
        displayName: 'Former member',
        role: 'member',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    db.insert(schema.taskLists)
      .values({ id: listId, familyId, ownerId: userId, name: 'Test', createdAt: 1, updatedAt: 1 })
      .run();
    const task = (isDone = false, targetListId = listId) => {
      const id = randomUUID();
      db.insert(schema.tasks)
        .values({
          id,
          listId: targetListId,
          title: 'Original task',
          notes: 'Notes',
          dueDate: '2026-01-31',
          dueTime: '10:00',
          isDone,
          doneAt: isDone ? 5 : null,
          doneBy: isDone ? userId : null,
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      return id;
    };
    const doneId = task(true),
      openId = task();
    db.insert(schema.taskChecklistItems)
      .values({ id: randomUUID(), taskId: openId, title: 'Step', position: 0, createdAt: 1, updatedAt: 1 })
      .run();
    db.insert(schema.taskOperations)
      .values({ id: randomUUID(), userId, listId, fingerprint: 'old', response: '{}', status: 200, createdAt: 1 })
      .run();
    db.insert(schema.reminders)
      .values({
        id: randomUUID(),
        familyId,
        taskId: openId,
        type: 'offset',
        offsetValue: 1,
        offsetUnit: 'day',
        audience: 'owner',
        createdBy: userId,
      })
      .run();
    const snapshot = () =>
      Object.fromEntries(
        ['tasks', 'task_checklist_items', 'task_operations', 'reminders', 'task_lists', 'users'].map((table) => [
          table,
          sqlite.prepare(`SELECT * FROM ${table}`).all(),
        ]),
      );
    const before = snapshot();
    migrate(db, { migrationsFolder });
    migrate(db, { migrationsFolder });
    expect(snapshot()).toEqual(before);
    expect(db.select().from(schema.taskOccurrences).all()).toEqual([]);
    expect(db.select().from(schema.taskSeries).all()).toEqual([]);

    db.insert(schema.taskSeries)
      .values({
        id: seriesId,
        listId,
        rule: {
          mode: 'schedule',
          unit: 'month',
          interval: 1,
          startDate: '2026-01-31',
          time: '10:00',
          timezone: 'Europe/Warsaw',
          endDate: null,
        },
        template: { title: 'Template', notes: null, assigneeId: null, reminders: [] },
        createdBy: historicalUserId,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const occurrence = (taskId: string, sequence: number, state: 'active' | 'done' | 'skipped' = 'active') =>
      db
        .insert(schema.taskOccurrences)
        .values({
          taskId,
          listId,
          seriesId,
          sequence,
          plannedDate: '2026-01-31',
          plannedTime: '10:00',
          state,
          closedAt: state === 'active' ? null : 5,
          closedBy: state === 'active' ? null : historicalUserId,
        })
        .run();
    occurrence(doneId, 0, 'done');
    occurrence(openId, 1);
    const successorId = task();
    expect(() => occurrence(successorId, 2)).toThrow(/UNIQUE/);
    expect(() => occurrence(successorId, 1, 'skipped')).toThrow(/UNIQUE/);
    expect(() => occurrence(successorId, -1, 'done')).toThrow(/CHECK/);
    expect(() =>
      db
        .insert(schema.taskOccurrences)
        .values({ taskId: successorId, listId, seriesId, sequence: 2, plannedDate: '2026-02-28', state: 'done' })
        .run(),
    ).toThrow(/CHECK/);

    // A failed successor insertion rolls back the predecessor closure too.
    expect(() =>
      sqlite
        .transaction(() => {
          sqlite.prepare("UPDATE task_occurrences SET state = 'done', closed_at = 9 WHERE task_id = ?").run(openId);
          occurrence(successorId, 0);
        })
        .immediate(),
    ).toThrow(/UNIQUE/);
    expect(sqlite.prepare('SELECT state FROM task_occurrences WHERE task_id = ?').get(openId)).toEqual({
      state: 'active',
    });
    sqlite
      .transaction(() => {
        sqlite.prepare("UPDATE task_occurrences SET state = 'skipped', closed_at = 9 WHERE task_id = ?").run(openId);
        occurrence(successorId, 2);
      })
      .immediate();
    expect(() => occurrence(task(), 2)).toThrow(/UNIQUE/);
    expect(
      db
        .select()
        .from(schema.taskOccurrences)
        .all()
        .map((item) => item.state),
    ).toEqual(['done', 'skipped', 'active']);

    const otherListId = randomUUID();
    db.insert(schema.taskLists)
      .values({ id: otherListId, familyId, ownerId: userId, name: 'Other', createdAt: 1, updatedAt: 1 })
      .run();
    expect(() => occurrence(task(false, otherListId), 3, 'done')).toThrow(/FOREIGN KEY/);
    // Deleting historical actors preserves history; list deletion clears the whole module.
    sqlite.prepare('DELETE FROM users WHERE id = ?').run(historicalUserId);
    expect(db.select().from(schema.taskOccurrences).all()).toHaveLength(3);
    expect(
      db
        .select()
        .from(schema.taskOccurrences)
        .all()
        .every((item) => item.closedBy === null),
    ).toBe(true);
    expect(db.select().from(schema.taskSeries).get()?.createdBy).toBeNull();
    sqlite.prepare('DELETE FROM task_lists WHERE id = ?').run(listId);
    expect(db.select().from(schema.taskOccurrences).all()).toEqual([]);
    expect(db.select().from(schema.taskSeries).all()).toEqual([]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    sqlite.close();
    rmSync(oldMigrations, { recursive: true, force: true });
  }
});
