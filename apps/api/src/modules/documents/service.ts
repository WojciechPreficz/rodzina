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
import { createReminderRepository } from '../reminders/repository.js';

export function createDocumentService(database: DatabaseConnection, now = () => Date.now()) {
  const repository = createDocumentRepository(database);
  const reminders = createReminderRepository(database);
  function withStatus(familyId: string, document: NonNullable<ReturnType<typeof repository.find>>) {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: repository.timezone(familyId),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now());
    return {
      ...document,
      status: getDocumentStatus(document.type, document.expiresOn, today),
      reminders: reminders.listDocument(familyId, document.id),
    };
  }
  function requireAdult(role: FamilyRole) {
    if (role === 'child') throw new ApiError(403, 'FORBIDDEN', 'Ta czynność jest dostępna tylko dla dorosłych.');
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
    list: (familyId: string) => repository.list(familyId).map((document) => withStatus(familyId, document)),
    create(familyId: string, actorId: string, role: FamilyRole, data: CreateDocument) {
      requireAdult(role);
      validateHolder(familyId, data);
      return database.db.transaction(() => {
        const { reminders: input, ...fields } = data;
        const document = repository.create(familyId, actorId, fields);
        reminders.saveDocument(
          familyId,
          document,
          actorId,
          input ?? getDefaultDocumentReminders(data.type),
          repository.timezone(familyId),
          now(),
        );
        return withStatus(familyId, document);
      });
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
        reminders.saveDocument(familyId, document, actorId, input, repository.timezone(familyId), now());
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
