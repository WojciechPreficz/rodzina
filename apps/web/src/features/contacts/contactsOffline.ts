import { z } from 'zod';
import { contactsResponseSchema } from '@rodzina/shared';
import { registerAdapter } from '../../offline/registry.js';
import { registerRecordMigration } from '../../offline/recordMigration.js';
import {
  accountToken,
  isAccountCurrent,
  activateOfflineAccount,
  ensureMigrated,
  readCache,
  writeCache,
  makeEntry,
  transact,
  assertContext,
} from '../../offline/database.js';
import { storageError } from '../../offline/status.js';

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
type State = { account: string; saved?: Snapshot; issue?: string };
const readError = 'Nie można odczytać kontaktów z pamięci urządzenia. Połącz się z internetem, aby pobrać je ponownie.';

registerAdapter({
  module: 'contacts',
  schemaVersion: 1,
  capabilities: 'read-only',
  separateMigration: true,
  legacyKey: CONTACTS_STORAGE_KEY,
  budget: 2 * 1048576,
  parseCache: (value) => snapshotSchema.parse(value),
  trim: (value) => value,
  describe: (value) => ({ syncedAt: snapshotSchema.parse(value).syncedAt, coverage: 'complete' }),
});
registerRecordMigration(
  'contacts',
  CONTACTS_STORAGE_KEY,
  (source) => {
    if (Object.keys(source).length !== 1 || !(CONTACTS_STORAGE_KEY in source))
      throw new Error('Nieobsługiwany format pamięci kontaktów.');
    return snapshotSchema.parse(JSON.parse(source[CONTACTS_STORAGE_KEY]!));
  },
  (tx, value) => {
    const entry = makeEntry('contacts', value);
    tx.objectStore('cache').put(entry);
    tx.objectStore('metadata').put({ accountId: entry.accountId, key: 'engine:contacts', value: 'legacy-idb' });
    tx.objectStore('metadata').put({ accountId: entry.accountId, key: 'budget:contacts', value: entry.chargedBytes });
  },
);
export const CONTACTS_SIGNAL = 'offline-contacts-changed:1';
export function createContactsStore() {
  let state: State = { account: '' };
  let generation = 0;
  let request = 0;
  let ready: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const emit = (next: State) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  async function reload() {
    const captured = ++generation;
    const token = accountToken();
    const account = state.account;
    try {
      await ensureMigrated();
      if (captured !== generation || !isAccountCurrent(token)) return;
      await activateOfflineAccount(account);
      const record = await readCache('contacts', account);
      if (captured !== generation || !isAccountCurrent(token)) return;
      const saved = record ? snapshotSchema.parse(record.payload) : undefined;
      if (saved && (record!.schemaVersion !== 1 || saved.account !== account)) throw new Error(readError);
      emit({ account, ...(saved ? { saved } : {}) });
    } catch (cause) {
      if (captured === generation && isAccountCurrent(token))
        emit({ ...state, issue: `${readError} ${storageError(cause)}` });
    }
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate(account: string) {
      if (state.account === account) return ready;
      emit({ account });
      ready = reload();
      return ready;
    },
    clear(removeStored = true) {
      generation++;
      const account = state.account;
      emit({ account: '' });
      ready = Promise.resolve();
      if (!removeStored || !account) return;
      return transact('readwrite', async (tx) => {
        const active = await assertContext(tx);
        if (active.accountId !== account) return;
        tx.objectStore('cache').delete([account, 'contacts', 'snapshot']);
        tx.objectStore('metadata').delete([account, 'budget:contacts']);
      });
    },
    reload: () => {
      ready = reload();
      return ready;
    },
    async fetch(account: string, load: () => Promise<unknown>) {
      const captured = generation;
      const token = accountToken();
      const sequence = ++request;
      const current = () => {
        if (
          captured !== generation ||
          !isAccountCurrent(token) ||
          sequence !== request ||
          state.account !== account ||
          !account
        )
          throw new DOMException('Session changed', 'AbortError');
      };
      const raw = await load();
      await ready;
      current();
      const saved = snapshotSchema.parse({ version: 1, account, syncedAt: Date.now(), data: raw });
      try {
        await writeCache('contacts', saved, token);
        current();
        emit({ account, saved });
        try {
          localStorage.setItem(CONTACTS_SIGNAL, crypto.randomUUID());
        } catch {
          /* IDB remains authoritative. */
        }
      } catch (cause) {
        current();
        emit({
          account,
          saved,
          issue: `Nie można zapisać kontaktów na urządzeniu. ${storageError(cause)} Kontakty mogą być niedostępne po zamknięciu aplikacji.`,
        });
      }
      return saved.data;
    },
  };
}
export const contactsStore = createContactsStore();
