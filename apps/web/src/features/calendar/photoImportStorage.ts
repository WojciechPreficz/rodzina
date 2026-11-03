import { z } from 'zod';
import {
  importEventSchema,
  importEventResultSchema,
  eventDuplicateResolutionSchema,
  type EventData,
  type ImportEventResult,
  type EventDuplicateResolution,
} from '@rodzina/shared';
import { assertContext, requestValue, transact } from '../../offline/database.js';

const entrySchema = z.object({
  operationId: z.string().uuid(),
  event: importEventSchema,
  result: importEventResultSchema.optional(),
  duplicateResolution: eventDuplicateResolutionSchema.optional(),
});
export type PhotoImportOperation = {
  operationId: string;
  event: EventData;
  result?: ImportEventResult | undefined;
  duplicateResolution?: EventDuplicateResolution | undefined;
};
const key = 'calendar-photo-import:1';

// Account metadata shares the session fence and logout cleanup with the offline database.
// Only approved event data is stored here, never the image or OCR source.
export async function readPhotoImports(): Promise<PhotoImportOperation[]> {
  return transact('readwrite', async (tx) => {
    const { accountId } = await assertContext(tx);
    const store = tx.objectStore('metadata');
    const record = await requestValue<{ value: unknown } | undefined>(store.get([accountId, key]));
    const entries = record ? z.array(entrySchema).parse(record.value) : [];
    // Results remain visible during the import, but a new visit restores only unfinished work.
    const unfinished = entries.filter((entry) => !entry.result || entry.result.status === 'error');
    if (unfinished.length !== entries.length) store.put({ accountId, key, value: unfinished });
    return unfinished;
  });
}

export async function writePhotoImports(updates: PhotoImportOperation[], remove: string[] = []) {
  return transact('readwrite', async (tx) => {
    const { accountId } = await assertContext(tx);
    const store = tx.objectStore('metadata');
    const record = await requestValue<{ value: unknown } | undefined>(store.get([accountId, key]));
    const entries = record ? z.array(entrySchema).parse(record.value) : [];
    const merged = new Map(
      entries.filter((entry) => !remove.includes(entry.operationId)).map((entry) => [entry.operationId, entry]),
    );
    for (const update of updates) {
      const parsed = entrySchema.parse(update);
      const previous = merged.get(update.operationId);
      if (
        previous &&
        JSON.stringify([previous.event, previous.duplicateResolution]) !==
          JSON.stringify([parsed.event, parsed.duplicateResolution])
      )
        throw new Error('Nie można zmienić danych wysłanej operacji.');
      // Another tab may already have resolved the same operation.
      merged.set(update.operationId, previous?.result ? previous : parsed);
    }
    store.put({ accountId, key, value: [...merged.values()] });
  });
}
