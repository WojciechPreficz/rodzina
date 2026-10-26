import { z } from 'zod';
import { contactsResponseSchema } from '@rodzina/shared';

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
type State = { account: string; saved?: Snapshot; issue?: string };
const readError = 'Nie można odczytać kontaktów z pamięci urządzenia. Połącz się z internetem, aby pobrać je ponownie.';

export function createContactsStore(storage: () => Storage = () => localStorage) {
  let state: State = { account: '' };
  let generation = 0;
  let request = 0;
  const listeners = new Set<() => void>();
  const emit = (next: State) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  function reload() {
    generation++;
    try {
      const raw = storage().getItem(CONTACTS_STORAGE_KEY);
      const saved = raw ? snapshotSchema.parse(JSON.parse(raw)) : undefined;
      emit({ account: state.account, ...(saved?.account === state.account ? { saved } : {}) });
    } catch {
      emit({ ...state, issue: readError });
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
      if (state.account === account) return;
      emit({ account });
      reload();
    },
    clear(removeStored = true) {
      generation++;
      emit({ account: '' });
      try {
        if (removeStored) storage().removeItem(CONTACTS_STORAGE_KEY);
      } catch {
        emit({
          account: '',
          issue: 'Nie można usunąć kontaktów z pamięci urządzenia. Włącz pamięć i wyloguj się ponownie.',
        });
      }
    },
    reload,
    async fetch(account: string, load: () => Promise<unknown>) {
      const captured = generation;
      const sequence = ++request;
      const raw = await load();
      if (captured !== generation || sequence !== request || state.account !== account || !account)
        throw new DOMException('Session changed', 'AbortError');
      const saved = snapshotSchema.parse({ version: 1, account, syncedAt: Date.now(), data: raw });
      try {
        storage().setItem(CONTACTS_STORAGE_KEY, JSON.stringify(saved));
        emit({ account, saved });
      } catch {
        emit({
          account,
          saved,
          issue:
            'Nie można zapisać kontaktów na urządzeniu. Zwolnij miejsce lub włącz pamięć przeglądarki. Kontakty mogą być niedostępne po zamknięciu aplikacji.',
        });
      }
      return saved.data;
    },
  };
}
export const contactsStore = createContactsStore();
