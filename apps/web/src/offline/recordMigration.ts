import {
  accountToken,
  isAccountCurrent,
  offlineOwner,
  prepareOfflineRecovery,
  transact,
  requestValue,
  PROTOCOL_KEY,
  CLEAR_PENDING_KEY,
} from './database.js';
import { offlineTransaction, type OfflineTransaction } from './transaction.js';
import { chargedBytes, type CacheEntry, type CacheModule } from './registry.js';
import { freezeParticipants, resumeParticipants } from './coordinator.js';
const error = (message: string): never => {
  throw new Error(message);
};
type ImportState = {
  accountId: string;
  module: CacheModule;
  importId: 'v1';
  phase: 'staged' | 'committed' | 'verified';
  source: Record<string, string>;
  data: { account: string };
  boundary: unknown;
  sourceDigest: string;
  targetDigest: string;
};
export function createRecordRecovery(
  module: ImportState['module'],
  legacyKey: string,
  parse: (source: Record<string, string>, account?: string, legacyPreview?: unknown) => { account: string },
  put: (tx: OfflineTransaction, data: unknown) => void | Promise<void>,
  options?: {
    journalPrefix?: string;
    previewFallback?: CacheModule;
    normalize?: (data: unknown) => unknown;
    encode?: (value: unknown) => string;
    lock?: 'module';
  },
) {
  const IMPORT_KEY = `offline-${module}-import:1`;
  const encode = options?.encode ?? JSON.stringify;
  const digest = async (value: unknown) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encode(value)))))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  const sources = () =>
    Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key === legacyKey || key.startsWith(options?.journalPrefix ?? `${legacyKey}:`))
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
  return async function recover() {
    const token = accountToken();
    const work = async () => {
      if (localStorage.getItem(CLEAR_PENDING_KEY)) error('Usuwanie danych konta nie zostało zakończone.');
      const owner = await offlineOwner(token);
      const states = owner
        ? await transact(
            'readonly',
            async (tx) => requestValue<ImportState[]>(tx.objectStore('migration').getAll()),
            token,
          )
        : [];
      let state = states.find((s) => s.module === module);
      const source = sources();
      if (!state && !Object.keys(source).length) return;
      if (!state && owner) {
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
      if (!navigator.locks?.query) error('Przeglądarka nie obsługuje bezpiecznej aktualizacji pamięci offline.');
      localStorage.setItem(IMPORT_KEY, 'migrating');
      localStorage.setItem(PROTOCOL_KEY, 'migrating');
      await freezeParticipants();
      const boundary = async (tx: IDBTransaction) =>
        requestValue(tx.objectStore('metadata').get(['__origin__', 'boundary']));
      const check = async (tx: IDBTransaction, s: ImportState) => {
        if (encode(await boundary(tx)) !== encode(s.boundary)) throw new DOMException('Session changed', 'AbortError');
      };
      if (!state) {
        const preview =
          owner &&
          options?.previewFallback &&
          (await transact(
            'readonly',
            async (tx) => {
              const entries = await requestValue<CacheEntry[]>(tx.objectStore('cache').getAll());
              return entries.find((entry) => entry.module === options.previewFallback)?.payload;
            },
            token,
          ));
        const data = parse(source, owner, preview);
        await prepareOfflineRecovery(data.account, token);
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
            if (await requestValue(tx.objectStore('metadata').get(['__origin__', 'suspended'])))
              throw new DOMException('Session changed', 'AbortError');
            await put(offlineTransaction(tx, staged.accountId), staged.data);
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
            if (
              encode(actual?.payload) !== encode(captured.data) &&
              (!options?.normalize || encode(actual?.payload) !== encode(options.normalize(captured.data)))
            )
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
      resumeParticipants();
    };
    if (navigator.locks) await navigator.locks.request(options?.lock === 'module' ? IMPORT_KEY : PROTOCOL_KEY, work);
    else await work();
  };
}
