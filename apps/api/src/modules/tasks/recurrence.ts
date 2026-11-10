import crypto from 'node:crypto';
import {
  firstTaskOccurrence,
  nextTaskOccurrence,
  type ConfigureTaskSeries,
  type PatchTask,
  type TaskSeriesTemplate,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import type { taskOccurrences, taskSeries, tasks } from '../../db/schema.js';
import { ApiError } from '../../http/errors.js';
import { createTaskListRepository } from './repository.js';
import { createReminderSourcePort } from '../reminders/source-port.js';
import { bumpTaskOccurrence, taskRecurrenceMany, createTaskRecurrenceRepository } from './recurrence-repository.js';

type TaskRow = typeof tasks.$inferSelect;
type SeriesRow = typeof taskSeries.$inferSelect;
type Versions = { expectedVersion: number; expectedOccurrenceVersion: number };

export function createTaskRecurrenceService(database: DatabaseConnection) {
  const db = database.db;
  const repository = createTaskListRepository(database);
  const seriesRepository = createTaskRecurrenceRepository(database);
  const reminders = createReminderSourcePort(database);
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
    const series = seriesRepository.findSeries(familyId, id);
    if (!series || !repository.findAccessibleList(familyId, actorId, series.listId))
      throw new ApiError(404, 'NOT_FOUND', 'Seria zadań nie istnieje.');
    return series;
  }
  function read(familyId: string, actorId: string, id: string) {
    const series = getSeries(familyId, actorId, id);
    const active = seriesRepository.findActive(id);
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
  function fingerprint(familyId: string, taskId: string) {
    const task = seriesRepository.findTask(familyId, taskId);
    if (!task) return null;
    // Delivery bookkeeping does not constitute a user edit of the successor.
    const reminderData = reminders
      .listAllTask(familyId, taskId)
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
    seriesRepository.insertOccurrence({
      taskId,
      listId: series.listId,
      seriesId: series.id,
      sequence,
      plannedDate: date,
      plannedTime: series.rule.time,
    });
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
    const previous = seriesRepository.lastClosure(series.id);
    const now = Date.now();
    const next = nextTaskOccurrence(series.rule, current.plannedDate, {
      actualAt,
      receivedAt: now,
      createdAt: task.createdAt,
      previousClosedAt: previous?.closedAt ?? null,
    });
    if (next.status === 'review' || now < series.updatedAt)
      throw new ApiError(409, 'TASK_CLOSURE_TIME_REVIEW', 'Czas zamknięcia zadania wymaga sprawdzenia.');
    seriesRepository.updateOccurrence(familyId, task.id, {
      state,
      closedAt: actualAt,
      closedBy: actorId,
      version: current.version + 1,
    });
    seriesRepository.completeTask(
      familyId,
      task.id,
      state === 'done' ? actualAt : null,
      state === 'done' ? actorId : null,
    );
    const version = series.version + 1;
    seriesRepository.updateSeries(familyId, series.id, {
      version,
      state: next.nextDate ? 'active' : 'ended',
      updatedAt: now,
    });
    let successorId: string | null = null;
    if (next.nextDate) {
      const list = repository.findAccessibleList(familyId, actorId, series.listId)!;
      const assigneeId = series.template.assigneeId;
      const template = {
        ...series.template,
        assigneeId:
          assigneeId && (assigneeId === list.ownerId || list.memberIds.includes(assigneeId)) ? assigneeId : null,
      };
      const { reminders: shared, checklist = [], ...fields } = template;
      const successor = repository.createTask(familyId, series.listId, actorId, {
        ...fields,
        dueDate: next.nextDate,
        dueTime: series.rule.time,
      });
      successorId = successor.id;
      insertOccurrence(series, successor.id, current.sequence + 1, next.nextDate);
      checklist.forEach((title, position) => {
        repository.insertChecklistItem({
          id: crypto.randomUUID(),
          taskId: successor.id,
          title,
          position,
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
        });
      });
      reminders.saveTask(familyId, successor, actorId, shared, series.rule.timezone, now);
    }
    seriesRepository.insertClosure({
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
      successorFingerprint: successorId ? fingerprint(familyId, successorId) : null,
    });
  }
  function undo(familyId: string, actorId: string, task: TaskRow) {
    const current = occurrence(task.id)!;
    const series = getSeries(familyId, actorId, current.seriesId);
    const history = seriesRepository.findClosure(series.id, current.sequence);
    if (!history || series.state === 'stopped' || history.seriesVersion !== series.version) conflict();
    if (history.successorId) {
      if (fingerprint(familyId, history.successorId) !== history.successorFingerprint) conflict();
      repository.removeTask(familyId, history.successorId);
    }
    const now = Date.now();
    seriesRepository.undoClosure(familyId, series.id, history.id, now, actorId);
    seriesRepository.updateOccurrence(familyId, task.id, {
      state: 'active',
      closedAt: null,
      closedBy: null,
      version: current.version + 1,
    });
    seriesRepository.updateSeries(familyId, series.id, {
      state: 'active',
      version: series.version + 1,
      updatedAt: now,
    });
  }
  return {
    occurrence,
    getSeries,
    read,
    history(familyId: string, actorId: string, id: string) {
      getSeries(familyId, actorId, id);
      return {
        ok: true as const,
        history: seriesRepository.listHistory(id),
      };
    },
    configure(familyId: string, actorId: string, id: string, data: ConfigureTaskSeries, create: boolean) {
      return transaction(() => {
        const task = create ? repository.findTask(familyId, actorId, id) : undefined;
        if (create && !task) throw new ApiError(404, 'NOT_FOUND', 'Zadanie nie istnieje.');
        const existing = create ? undefined : getSeries(familyId, actorId, id);
        const active = existing ? seriesRepository.findActive(id) : undefined;
        const target = task ?? (active ? repository.findTask(familyId, actorId, active.taskId) : undefined);
        if (!target || target.isDone || (create && occurrence(target.id))) conflict();
        if (existing) {
          if (existing.state !== 'active' || !active) conflict();
          checkVersions(existing, active, data);
        } else if (data.expectedVersion !== 0 || data.expectedOccurrenceVersion !== 0) conflict();
        validateTemplate(familyId, actorId, target.listId, data.template);
        // Older clients omit the checklist; preserve the stored template on edits.
        const template = {
          ...data.template,
          checklist:
            data.template.checklist ??
            existing?.template.checklist ??
            (repository.checklistMany([target.id]).get(target.id) ?? []).map((item) => item.title),
        };
        const changedRule = !existing || JSON.stringify(existing.rule) !== JSON.stringify(data.rule);
        const date = changedRule ? firstTaskOccurrence(data.rule) : active!.plannedDate;
        if (!date) throw new ApiError(400, 'VALIDATION_ERROR', 'Reguła nie zawiera żadnego terminu.');
        const now = Date.now();
        const seriesId = existing?.id ?? crypto.randomUUID();
        if (existing)
          seriesRepository.updateSeries(familyId, id, {
            rule: data.rule,
            template,
            version: existing.version + 1,
            updatedAt: now,
          });
        else {
          database.familyRecordLimits.requireCapacity('taskSeries', familyId);
          seriesRepository.insertSeries({
            id: seriesId,
            listId: target.listId,
            rule: data.rule,
            template,
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
          });
        }
        const series = getSeries(familyId, actorId, seriesId);
        if (active)
          seriesRepository.updateOccurrence(familyId, target.id, {
            plannedDate: date,
            plannedTime: data.rule.time,
            version: active.version + 1,
          });
        else insertOccurrence(series, target.id, 0, date);
        const { reminders: shared, title, notes, assigneeId } = template;
        const updated = repository.updateTask(familyId, target, actorId, {
          title,
          notes,
          assigneeId,
          dueDate: date,
          dueTime: data.rule.time,
        });
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
        seriesRepository.removeOccurrence(familyId, current.taskId);
        seriesRepository.updateSeries(familyId, id, {
          state: 'stopped',
          version: result.series.version + 1,
          updatedAt: Date.now(),
        });
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
        if (
          data.expectedOccurrenceVersion !== undefined ||
          data.expectedSeriesId !== undefined ||
          data.closedAt !== undefined
        )
          conflict();
        return;
      }
      const series = getSeries(familyId, actorId, current.seriesId);
      if (data.expectedSeriesId !== undefined && data.expectedSeriesId !== current.seriesId) conflict();
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
          (key) =>
            !['isDone', 'closedAt', 'expectedSeriesVersion', 'expectedOccurrenceVersion', 'expectedSeriesId'].includes(
              key,
            ),
        )
      )
        bumpTaskOccurrence(database, familyId, previous.id);
    },
    beforeDelete(familyId: string, actorId: string, task: TaskRow) {
      close(familyId, actorId, task, 'skipped', Date.now());
    },
  };
}
