import { z } from 'zod';
import { contactsResponseSchema } from '@rodzina/shared';
import { cacheSignal, registerOfflineModule } from '../../offline/index.js';

export const CONTACTS_STORAGE_KEY = 'rodzina:contacts:v1';
const snapshotSchema = z
  .object({
    version: z.literal(1),
    account: z.string().min(1),
    syncedAt: z.number().int().positive(),
    data: contactsResponseSchema,
  })
  .superRefine(({ account, data }, ctx) => {
    const familyId = account.split(':')[0];
    const groups = new Set(data.groups.map((group) => group.id));
    if (
      data.groups.filter((group) => group.isDefault).length !== 1 ||
      groups.size !== data.groups.length ||
      new Set(data.contacts.map((contact) => contact.id)).size !== data.contacts.length ||
      data.groups.some((group) => group.familyId !== familyId) ||
      data.contacts.some((contact) => contact.familyId !== familyId || !groups.has(contact.groupId))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid contacts snapshot' });
  });
type Snapshot = z.infer<typeof snapshotSchema>;
export const parseContactsSnapshot = (value: unknown) => snapshotSchema.parse(value);
const contactsModule = registerOfflineModule({
  mode: 'read-only',
  cache: {
    module: 'contacts',
    schemaVersion: 1,
    separateMigration: true,
    legacyKey: CONTACTS_STORAGE_KEY,
    budget: 2 * 1048576,
    parseCache: parseContactsSnapshot,
    trim: (value) => value,
    describe: (value) => ({ syncedAt: parseContactsSnapshot(value).syncedAt, coverage: 'complete' }),
  },
  project: (snapshot: Snapshot) => snapshot.data,
  readError: (detail) =>
    `Nie można odczytać kontaktów z pamięci urządzenia. Połącz się z internetem, aby pobrać je ponownie. ${detail}`,
  writeError: (detail) =>
    `Nie można zapisać kontaktów na urządzeniu. ${detail} Kontakty mogą być niedostępne po zamknięciu aplikacji.`,
});
export const CONTACTS_SIGNAL = cacheSignal('contacts');
export function createContactsStore() {
  const store = contactsModule.createStore();
  return {
    ...store,
    async fetch(account: string, load: () => Promise<unknown>) {
      const saved = await store.fetchSnapshot(account, load, (data) => ({
        version: 1,
        account,
        syncedAt: Date.now(),
        data,
      }));
      return saved.data;
    },
  };
}
export const contactsStore = createContactsStore();
export const registerContactsStore = () => contactsModule.registerStore(contactsStore);
