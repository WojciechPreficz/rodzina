import { createFamilyReader } from '../family/reader.js';
import { formatLocalDate } from '../../http/local-date.js';
import { requireAdult } from '../../http/require-adult.js';
import {
  getDocumentStatus,
  getDefaultDocumentReminders,
  type CreateDocument,
  type PatchDocument,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import type { FamilyRole } from '../../permissions.js';
import { ApiError } from '../../http/errors.js';
import { createDocumentRepository } from './repository.js';
import { createReminderSourcePort } from '../reminders/source-port.js';

export function createDocumentService(database: DatabaseConnection, now = () => Date.now()) {
  const repository = createDocumentRepository(database);
  const { timezone } = createFamilyReader(database);
  const reminders = createReminderSourcePort(database);
  function withStatus(familyId: string, document: NonNullable<ReturnType<typeof repository.find>>) {
    const today = formatLocalDate(now(), timezone(familyId));
    return {
      ...document,
      status: getDocumentStatus(document.type, document.expiresOn, today),
      reminders: reminders.listDocument(familyId, document.id),
    };
  }
  function find(familyId: string, id: string) {
    const document = repository.find(familyId, id);
    if (!document) throw new ApiError(404, 'NOT_FOUND', 'Dokument nie istnieje.');
    return document;
  }
  function validateHolder(familyId: string, data: CreateDocument) {
    if (data.holderUserId && !repository.hasHolder(familyId, data.holderUserId))
      throw new ApiError(400, 'VALIDATION_ERROR', 'Posiadacz musi należeć do rodziny.');
    if (data.holderUserId && !['id_card', 'passport'].includes(data.type))
      throw new ApiError(400, 'VALIDATION_ERROR', 'Ten typ dokumentu nie ma posiadacza.');
    if (data.vehicleLabel && !['car_insurance', 'car_inspection', 'car_guarantee_inspection'].includes(data.type))
      throw new ApiError(400, 'VALIDATION_ERROR', 'Ten typ dokumentu nie dotyczy pojazdu.');
  }
  return {
    findSource: repository.find,
    listSources: repository.list,
    list: (familyId: string) => repository.list(familyId).map((document) => withStatus(familyId, document)),
    create(familyId: string, actorId: string, role: FamilyRole, data: CreateDocument) {
      requireAdult(role);
      validateHolder(familyId, data);
      return database.db.transaction(
        () => {
          database.familyRecordLimits.requireCapacity('documents', familyId);
          const { reminders: input, ...fields } = data;
          const document = repository.create(familyId, actorId, fields);
          reminders.saveDocument(
            familyId,
            document,
            actorId,
            input ?? getDefaultDocumentReminders(data.type),
            timezone(familyId),
            now(),
          );
          return withStatus(familyId, document);
        },
        { behavior: 'immediate' },
      );
    },
    update(familyId: string, id: string, actorId: string, role: FamilyRole, data: PatchDocument) {
      requireAdult(role);
      const current = find(familyId, id);
      validateHolder(familyId, {
        ...current,
        ...data,
        type: data.type ?? current.type,
        label: data.label ?? current.label,
        expiresOn: data.expiresOn ?? current.expiresOn,
      });
      return database.db.transaction(() => {
        const { reminders: input, ...fields } = data;
        const document = repository.update(familyId, id, fields)!;
        reminders.saveDocument(familyId, document, actorId, input, timezone(familyId), now());
        return withStatus(familyId, document);
      });
    },
    remove(familyId: string, id: string, role: FamilyRole) {
      requireAdult(role);
      find(familyId, id);
      repository.remove(familyId, id);
    },
  };
}
