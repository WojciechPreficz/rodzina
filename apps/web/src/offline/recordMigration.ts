import {
  accountToken,
  isAccountCurrent,
  transact,
  requestValue,
  registerMigration,
  PROTOCOL_KEY,
  CLEAR_PENDING_KEY,
} from './database.js';
import { chargedBytes, type CacheEntry } from './registry.js';
import { requireMigration } from './status.js';
import { freezeParticipants, resumeParticipants } from './coordinator.js';
const error = (message: string): never => {
  throw new Error(message);
};
const canonical = (value: unknown) => JSON.stringify(value);
const digest = async (value: unknown) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
type ImportState = {
  accountId: string;
  module: 'tasks' | 'contacts';
  importId: 'v1';
  phase: 'staged' | 'committed' | 'verified';
  source: Record<string, string>;
  data: { account: string };
  boundary: unknown;
  sourceDigest: string;
  targetDigest: string;
};
export function registerRecordMigration(
  module: 'tasks' | 'contacts',
  legacyKey: string,
  parse: (source: Record<string, string>, account?: string) => { account: string },
  put: (tx: IDBTransaction, data: unknown) => void,
) {
  const IMPORT_KEY = `offline-${module}-import:1`;
  const sources = () =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key === legacyKey || key.startsWith(`${legacyKey}:`))
        .sort()
        .map((key) => [key, localStorage.getItem(key)!]),
    );
  const assertSource = (state: ImportState, removed = false) => {
    const current = sources();
    if (
      Object.keys(current).some((key) => !(key in state.source)) ||
      Object.entries(state.source).some(
        ([key, value]) => current[key] !== value && !(removed && current[key] === undefined),
      )
    )
      error('Dane starej karty zmieniły się podczas importu. Zamknij starsze karty i ponów aktualizację.');
  };
  async function migrate(confirmed: boolean) {
    const token = accountToken();
    const work = async () => {
      if (localStorage.getItem(CLEAR_PENDING_KEY)) error('Usuwanie danych konta nie zostało zakończone.');
      const states = await transact(
        'readonly',
        async (tx) => requestValue<ImportState[]>(tx.objectStore('migration').getAll()),
        token,
      );
      let state = states.find((s) => s.module === module);
      const source = sources();
      if (!state && !Object.keys(source).length) return;
      if (!state) {
        const markers = await transact(
          'readonly',
          async (tx) => requestValue<{ key: string }[]>(tx.objectStore('metadata').getAll()),
          token,
        );
        if (markers.some((m) => m.key === `import:${module}:v1` || m.key === `engine:${module}`))
          error(
            'Starsza karta ponownie zapisała dane offline po aktualizacji. Zamknij ją i wyloguj się przed dalszą pracą.',
          );
      }
      if (!confirmed && localStorage.getItem(IMPORT_KEY) !== 'migrating') {
        requireMigration(true);
        error('Dane offline wymagają przeniesienia. Zamknij starsze karty aplikacji i potwierdź aktualizację pamięci.');
      }
      if (!navigator.locks?.query) error('Przeglądarka nie obsługuje bezpiecznej aktualizacji pamięci offline.');
      localStorage.setItem(IMPORT_KEY, 'migrating');
      localStorage.setItem(PROTOCOL_KEY, 'migrating');
      await freezeParticipants();
      const boundary = async (tx: IDBTransaction) =>
        requestValue(tx.objectStore('metadata').get(['__origin__', 'boundary']));
      const check = async (tx: IDBTransaction, s: ImportState) => {
        if (canonical(await boundary(tx)) !== canonical(s.boundary))
          throw new DOMException('Session changed', 'AbortError');
      };
      if (!state) {
        const active = await transact(
          'readonly',
          async (tx) =>
            requestValue<{ value: { accountId: string } } | undefined>(
              tx.objectStore('metadata').get(['__origin__', 'active']),
            ),
          token,
        );
        const data = parse(source, active?.value.accountId);
        if (active && active.value.accountId !== data.account) error('Dane offline należą do innego konta.');
        state = {
          accountId: data.account,
          module,
          importId: 'v1',
          phase: 'staged',
          source,
          data,
          boundary: await transact('readonly', boundary, token),
          sourceDigest: await digest(source),
          targetDigest: await digest(data),
        };
        if (chargedBytes(data.account, state) > 48 * 1048576) error('Brak miejsca na kopię importu offline.');
        const estimate = await navigator.storage?.estimate?.();
        const needed = 2 * new TextEncoder().encode(JSON.stringify([source, data])).byteLength + 1048576;
        if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < needed)
          error('Brak miejsca na bezpieczny import offline.');
        assertSource(state);
        const staged = state;
        await transact(
          'readwrite',
          async (tx) => {
            await check(tx, staged);
            tx.objectStore('migration').put(staged);
          },
          token,
        );
      }
      if ((await digest(state.source)) !== state.sourceDigest || (await digest(state.data)) !== state.targetDigest)
        error('Kopia robocza importu offline jest uszkodzona. Źródło zostało zachowane.');
      if (state.phase === 'staged') {
        assertSource(state);
        const staged = state;
        await transact(
          'readwrite',
          async (tx) => {
            await check(tx, staged);
            const active = await requestValue<{ value: { accountId: string } } | undefined>(
              tx.objectStore('metadata').get(['__origin__', 'active']),
            );
            if (active && active.value.accountId !== staged.accountId)
              throw new DOMException('Session changed', 'AbortError');
            put(tx, staged.data);
            if (!active)
              tx.objectStore('metadata').put({
                accountId: '__origin__',
                key: 'active',
                value: { accountId: staged.accountId, generation: crypto.randomUUID() },
              });
            tx.objectStore('migration').put({ ...staged, phase: 'committed' });
          },
          token,
        );
        state = { ...state, phase: 'committed' };
      }
      const captured = state;
      if (state.phase === 'committed') {
        assertSource(state);
        await transact(
          'readwrite',
          async (tx) => {
            await check(tx, captured);
            const actual = await requestValue<CacheEntry>(
              tx.objectStore('cache').get([captured.accountId, module, 'snapshot']),
            );
            if (canonical(actual?.payload) !== canonical(captured.data))
              error('Weryfikacja importu offline nie powiodła się.');
            tx.objectStore('migration').put({ ...captured, phase: 'verified' });
          },
          token,
        );
      }
      if (!isAccountCurrent(token)) throw new DOMException('Session changed', 'AbortError');
      assertSource(captured, true);
      for (const key of Object.keys(captured.source)) localStorage.removeItem(key);
      if (Object.keys(captured.source).some((key) => localStorage.getItem(key) !== null))
        error('Nie można usunąć starej pamięci offline.');
      await transact(
        'readwrite',
        async (tx) => {
          await check(tx, captured);
          tx.objectStore('migration').delete([captured.accountId, module, 'v1']);
          tx.objectStore('metadata').put({
            accountId: captured.accountId,
            key: `import:${module}:v1`,
            value: 'active',
          });
        },
        token,
      );
      localStorage.setItem(IMPORT_KEY, 'active');
      localStorage.setItem(PROTOCOL_KEY, 'active');
      requireMigration(false);
      resumeParticipants();
    };
    if (navigator.locks) await navigator.locks.request(PROTOCOL_KEY, work);
    else await work();
  }

  registerMigration(module, migrate);
}
