import { activateOfflineAccount, clearDatabase, closeDatabase } from '../../offline/testing.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { readPhotoImports, writePhotoImports, type PhotoImportOperation } from './photoImportStorage.js';

const operation: PhotoImportOperation = {
  operationId: '11111111-1111-4111-8111-111111111111',
  event: {
    title: 'Koncert',
    startDate: '2026-11-12',
    startTime: '18:30',
    durationMinutes: 60,
    description: null,
    location: null,
    participantIds: [],
    kind: 'single',
    datePrecision: 'day',
    rrule: null,
  },
};
beforeEach(async () => {
  await activateOfflineAccount('family:user');
});
describe('approved photo import persistence', () => {
  it('restores a replacement decision unchanged and refuses to reuse its ID with another choice', async () => {
    const chosen = {
      ...operation,
      duplicateResolution: { action: 'replace' as const, eventId: crypto.randomUUID(), version: 'a'.repeat(64) },
    };
    await writePhotoImports([chosen]);
    await closeDatabase();
    await activateOfflineAccount('family:user');
    expect(await readPhotoImports()).toEqual([chosen]);
    await expect(writePhotoImports([{ ...chosen, duplicateResolution: { action: 'add' } }])).rejects.toThrow(
      'Nie można zmienić',
    );
  });
  it('restores immutable data and per-item rejections after a restart', async () => {
    await writePhotoImports([operation]);
    await closeDatabase();
    await activateOfflineAccount('family:user');
    expect(await readPhotoImports()).toEqual([operation]);
    await expect(
      writePhotoImports([{ ...operation, event: { ...operation.event, title: 'Changed' } }]),
    ).rejects.toThrow('Nie można zmienić');
    const rejected = {
      ...operation,
      result: {
        operationId: operation.operationId,
        status: 'error' as const,
        error: { code: 'INVALID_EVENT', message: 'Popraw datę' },
      },
    };
    await writePhotoImports([rejected]);
    await closeDatabase();
    await activateOfflineAccount('family:user');
    expect(await readPhotoImports()).toEqual([rejected]);
  });
  it.each(['created', 'already_created'] as const)(
    'merges tabs and clears %s results on a new visit without losing unfinished imports',
    async (status) => {
      const other = { ...operation, operationId: crypto.randomUUID() };
      await Promise.all([writePhotoImports([operation]), writePhotoImports([other])]);
      const success = {
        ...operation,
        result: { status, operationId: operation.operationId, eventId: crypto.randomUUID() },
      };
      await writePhotoImports([success]);
      await writePhotoImports([operation]);
      expect(await readPhotoImports()).toEqual([other]);
      await writePhotoImports([], [other.operationId]);
      expect(await readPhotoImports()).toEqual([]);
    },
  );
  it('rolls back storage errors, fences account changes and clears on logout', async () => {
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Pełna pamięć', 'QuotaExceededError');
    });
    await expect(writePhotoImports([operation])).rejects.toThrow('Pełna pamięć');
    spy.mockRestore();
    expect(await readPhotoImports()).toEqual([]);
    await writePhotoImports([operation]);
    const pending = writePhotoImports([{ ...operation, operationId: crypto.randomUUID() }]);
    await closeDatabase();
    await expect(pending).rejects.toThrow('Session changed');
    await expect(activateOfflineAccount('family:other')).rejects.toThrow('Session changed');
    await clearDatabase();
    await activateOfflineAccount('family:other');
    expect(await readPhotoImports()).toEqual([]);
    await clearDatabase();
    await activateOfflineAccount('family:user');
    expect(await readPhotoImports()).toEqual([]);
  });
});
