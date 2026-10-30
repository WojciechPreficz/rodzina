import crypto from 'node:crypto';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import {
  firstTaskOccurrence,
  nextTaskOccurrence,
  type ConfigureTaskSeries,
  type PatchTask,
  type TaskSeriesTemplate,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { taskOccurrences, taskSeries, taskSeriesHistory, tasks, reminders as reminderRows } from '../../db/schema.js';
import { ApiError } from '../../http/errors.js';
import { createTaskListRepository } from './repository.js';
import { createReminderRepository } from '../reminders/repository.js';
import { bumpTaskOccurrence, taskRecurrenceMany } from './recurrence-data.js';

type TaskRow = typeof tasks.$inferSelect;
type SeriesRow = typeof taskSeries.$inferSelect;
type Versions = { expectedVersion: number; expectedOccurrenceVersion: number };

export function createTaskRecurrenceService(database: DatabaseConnection) {
  const db = database.db;
  const repository = createTaskListRepository(database);
  const reminders = createReminderRepository(database);
  const transaction = <T>(operation: () => T) => db.transaction(operation, { behavior: 'immediate' });
  function conflict(): never {
    throw new ApiError(
      409,
      'TASK_RECURRENCE_CONFLICT',
      'Seria lub wystąpienie zostały zmienione. Pobierz aktualne dane i sprawdź zmianę.',
    );
  }
  function occurrence(taskId: string) {
    return taskRecurrenceMany(database, [taskId]).get(taskId);
  }
  function getSeries(familyId: string, actorId: string, id: string) {
    const series = db.select().from(taskSeries).where(eq(taskSeries.id, id)).get();
    if (!series || !repository.findAccessibleList(familyId, actorId, series.listId))
      throw new ApiError(404, 'NOT_FOUND', 'Seria zadań nie istnieje.');
    return series;
  }
  function read(familyId: string, actorId: string, id: string) {
    const series = getSeries(familyId, actorId, id);
    const active = db
      .select()
      .from(taskOccurrences)
      .where(and(eq(taskOccurrences.seriesId, id), eq(taskOccurrences.state, 'active')))
      .get();
    return {
      ok: true as const,
      series,
      activeTaskId: active?.taskId ?? null,
      occurrenceVersion: active?.version ?? null,
    };
  }
  function validateTemplate(familyId: string, actorId: string, listId: string, template: TaskSeriesTemplate) {
    const list = repository.findAccessibleList(familyId, actorId, listId)!;
    if (template.assigneeId && template.assigneeId !== list.ownerId && !list.memberIds.includes(template.assigneeId))
      throw new ApiError(400, 'VALIDATION_ERROR', 'Zadanie można przypisać tylko właścicielowi lub członkowi listy.');
  }
  function fingerprint(taskId: string) {
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task) return null;
    // Delivery bookkeeping does not constitute a user edit of the successor.
    const reminderData = db
      .select()
      .from(reminderRows)
      .where(eq(reminderRows.taskId, taskId))
      .orderBy(asc(reminderRows.id))
      .all()
      .map((row) => ({ ...row, nextFireAt: null, lastSentAt: null }));
    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          task,
          occurrence: occurrence(taskId),
          checklist: repository.checklistMany([taskId]).get(taskId) ?? [],
          reminders: reminderData,
        }),
      )
      .digest('hex');
  }
  function insertOccurrence(series: SeriesRow, taskId: string, sequence: number, date: string) {
    db.insert(taskOccurrences)
      .values({
        taskId,
        listId: series.listId,
        seriesId: series.id,
        sequence,
        plannedDate: date,
        plannedTime: series.rule.time,
      })
      .run();
  }
  function checkVersions(series: SeriesRow, current: typeof taskOccurrences.$inferSelect, versions: Versions) {
    if (series.version !== versions.expectedVersion || current.version !== versions.expectedOccurrenceVersion)
      conflict();
  }
  function close(familyId: string, actorId: string, task: TaskRow, state: 'done' | 'skipped', actualAt: number) {
    const current = occurrence(task.id);
    if (!current || current.state !== 'active') return;
    const series = getSeries(familyId, actorId, current.seriesId);
    if (series.state !== 'active') conflict();
    const previous = db
      .select()
      .from(taskSeriesHistory)
      .where(and(eq(taskSeriesHistory.seriesId, series.id), isNull(taskSeriesHistory.undoneAt)))
      .orderBy(desc(taskSeriesHistory.sequence))
      .get();
    const now = Date.now();
    const next = nextTaskOccurrence(series.rule, current.plannedDate, {
      actualAt,
      receivedAt: now,
      createdAt: task.createdAt,
      previousClosedAt: previous?.closedAt ?? null,
    });
    if (next.status === 'review' || now < series.updatedAt)
      throw new ApiError(409, 'TASK_CLOSURE_TIME_REVIEW', 'Czas zamknięcia zadania wymaga sprawdzenia.');
    db.update(taskOccurrences)
      .set({ state, closedAt: actualAt, closedBy: actorId, version: current.version + 1 })
      .where(eq(taskOccurrences.taskId, task.id))
      .run();
    db.update(tasks)
      .set({ isDone: true, doneAt: state === 'done' ? actualAt : null, doneBy: state === 'done' ? actorId : null })
      .where(eq(tasks.id, task.id))
      .run();
    const version = series.version + 1;
    db.update(taskSeries)
      .set({ version, state: next.nextDate ? 'active' : 'ended', updatedAt: now })
      .where(eq(taskSeries.id, series.id))
      .run();
    let successorId: string | null = null;
    if (next.nextDate) {
      const list = repository.findAccessibleList(familyId, actorId, series.listId)!;
      const assigneeId = series.template.assigneeId;
      const template = {
        ...series.template,
        assigneeId:
          assigneeId && (assigneeId === list.ownerId || list.memberIds.includes(assigneeId)) ? assigneeId : null,
      };
      const { reminders: shared, ...fields } = template;
      const successor = repository.createTask(series.listId, actorId, {
        ...fields,
        dueDate: next.nextDate,
        dueTime: series.rule.time,
      });
      successorId = successor.id;
      insertOccurrence(series, successor.id, current.sequence + 1, next.nextDate);
      reminders.saveTask(familyId, successor, actorId, shared, series.rule.timezone, now);
    }
    db.insert(taskSeriesHistory)
      .values({
        id: crypto.randomUUID(),
        seriesId: series.id,
        taskId: task.id,
        sequence: current.sequence,
        title: task.title,
        plannedDate: current.plannedDate,
        plannedTime: current.plannedTime,
        state,
        closedAt: actualAt,
        closedBy: actorId,
        seriesVersion: version,
        successorId,
        successorFingerprint: successorId ? fingerprint(successorId) : null,
      })
      .run();
  }
  function undo(familyId: string, actorId: string, task: TaskRow) {
    const current = occurrence(task.id)!;
    const series = getSeries(familyId, actorId, current.seriesId);
    const history = db
      .select()
      .from(taskSeriesHistory)
      .where(
        and(
          eq(taskSeriesHistory.seriesId, series.id),
          eq(taskSeriesHistory.sequence, current.sequence),
          isNull(taskSeriesHistory.undoneAt),
        ),
      )
      .get();
    if (!history || series.state === 'stopped' || history.seriesVersion !== series.version) conflict();
    if (history.successorId) {
      if (fingerprint(history.successorId) !== history.successorFingerprint) conflict();
      repository.removeTask(history.successorId);
    }
    const now = Date.now();
    db.update(taskSeriesHistory)
      .set({ undoneAt: now, undoneBy: actorId })
      .where(eq(taskSeriesHistory.id, history.id))
      .run();
    db.update(taskOccurrences)
      .set({ state: 'active', closedAt: null, closedBy: null, version: current.version + 1 })
      .where(eq(taskOccurrences.taskId, task.id))
      .run();
    db.update(taskSeries)
      .set({ state: 'active', version: series.version + 1, updatedAt: now })
      .where(eq(taskSeries.id, series.id))
      .run();
  }
  return {
    occurrence,
    getSeries,
    read,
    history(familyId: string, actorId: string, id: string) {
      getSeries(familyId, actorId, id);
      return {
        ok: true as const,
        history: db
          .select()
          .from(taskSeriesHistory)
          .where(eq(taskSeriesHistory.seriesId, id))
          .orderBy(asc(taskSeriesHistory.sequence), asc(taskSeriesHistory.closedAt))
          .all(),
      };
    },
    configure(familyId: string, actorId: string, id: string, data: ConfigureTaskSeries, create: boolean) {
      return transaction(() => {
        const task = create ? repository.findTask(familyId, actorId, id) : undefined;
        if (create && !task) throw new ApiError(404, 'NOT_FOUND', 'Zadanie nie istnieje.');
        const existing = create ? undefined : getSeries(familyId, actorId, id);
        const active = existing
          ? db
              .select()
              .from(taskOccurrences)
              .where(and(eq(taskOccurrences.seriesId, id), eq(taskOccurrences.state, 'active')))
              .get()
          : undefined;
        const target = task ?? (active ? repository.findTask(familyId, actorId, active.taskId) : undefined);
        if (!target || target.isDone || (create && occurrence(target.id))) conflict();
        if (existing) {
          if (existing.state !== 'active' || !active) conflict();
          checkVersions(existing, active, data);
        } else if (data.expectedVersion !== 0 || data.expectedOccurrenceVersion !== 0) conflict();
        validateTemplate(familyId, actorId, target.listId, data.template);
        const changedRule = !existing || JSON.stringify(existing.rule) !== JSON.stringify(data.rule);
        const date = changedRule ? firstTaskOccurrence(data.rule) : active!.plannedDate;
        if (!date) throw new ApiError(400, 'VALIDATION_ERROR', 'Reguła nie zawiera żadnego terminu.');
        const now = Date.now();
        const seriesId = existing?.id ?? crypto.randomUUID();
        if (existing)
          db.update(taskSeries)
            .set({ rule: data.rule, template: data.template, version: existing.version + 1, updatedAt: now })
            .where(eq(taskSeries.id, id))
            .run();
        else
          db.insert(taskSeries)
            .values({
              id: seriesId,
              listId: target.listId,
              rule: data.rule,
              template: data.template,
              createdBy: actorId,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        const series = getSeries(familyId, actorId, seriesId);
        if (active)
          db.update(taskOccurrences)
            .set({ plannedDate: date, plannedTime: data.rule.time, version: active.version + 1 })
            .where(eq(taskOccurrences.taskId, target.id))
            .run();
        else insertOccurrence(series, target.id, 0, date);
        const { reminders: shared, ...fields } = data.template;
        const updated = repository.updateTask(target, actorId, { ...fields, dueDate: date, dueTime: data.rule.time });
        reminders.saveTask(familyId, updated, actorId, shared, data.rule.timezone, now);
        return read(familyId, actorId, seriesId);
      });
    },
    stop(familyId: string, actorId: string, id: string, versions: Versions) {
      return transaction(() => {
        const result = read(familyId, actorId, id);
        if (!result.activeTaskId || result.series.state !== 'active') conflict();
        const current = occurrence(result.activeTaskId)!;
        checkVersions(result.series, current, versions);
        db.delete(taskOccurrences).where(eq(taskOccurrences.taskId, current.taskId)).run();
        db.update(taskSeries)
          .set({ state: 'stopped', version: result.series.version + 1, updatedAt: Date.now() })
          .where(eq(taskSeries.id, id))
          .run();
        return read(familyId, actorId, id);
      });
    },
    skip(
      familyId: string,
      actorId: string,
      taskId: string,
      data: { expectedSeriesVersion: number; expectedOccurrenceVersion: number; closedAt: number },
    ) {
      return transaction(() => {
        const task = repository.findTask(familyId, actorId, taskId);
        if (!task) throw new ApiError(404, 'NOT_FOUND', 'Zadanie nie istnieje.');
        const current = occurrence(taskId);
        if (!current || current.state !== 'active') conflict();
        const series = getSeries(familyId, actorId, current.seriesId);
        checkVersions(series, current, {
          expectedVersion: data.expectedSeriesVersion,
          expectedOccurrenceVersion: data.expectedOccurrenceVersion,
        });
        close(familyId, actorId, task, 'skipped', data.closedAt);
        const updated = repository.findTask(familyId, actorId, taskId)!;
        reminders.saveTask(familyId, updated, actorId, undefined, series.rule.timezone, Date.now());
        return {
          ok: true as const,
          taskRecurrenceVersion: 1 as const,
          task: {
            ...updated,
            recurrence: occurrence(taskId),
            checklist: repository.checklistMany([taskId]).get(taskId) ?? [],
            reminders: reminders.listTask(familyId, taskId),
          },
        };
      });
    },
    patch(familyId: string, actorId: string, previous: TaskRow, updated: TaskRow, data: PatchTask) {
      const current = occurrence(previous.id);
      if (!current) {
        if (data.expectedOccurrenceVersion !== undefined || data.closedAt !== undefined) conflict();
        return;
      }
      const series = getSeries(familyId, actorId, current.seriesId);
      if (data.expectedOccurrenceVersion !== undefined)
        checkVersions(series, current, {
          expectedVersion: data.expectedSeriesVersion!,
          expectedOccurrenceVersion: data.expectedOccurrenceVersion,
        });
      if (data.isDone === true && current.state === 'active')
        close(familyId, actorId, updated, 'done', data.closedAt ?? Date.now());
      else if (data.isDone === false && current.state !== 'active') undo(familyId, actorId, previous);
      else if (
        Object.keys(data).some(
          (key) => !['isDone', 'closedAt', 'expectedSeriesVersion', 'expectedOccurrenceVersion'].includes(key),
        )
      )
        bumpTaskOccurrence(database, previous.id);
    },
    beforeDelete(familyId: string, actorId: string, task: TaskRow) {
      close(familyId, actorId, task, 'skipped', Date.now());
    },
  };
}
