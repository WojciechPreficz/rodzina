import {
  accountToken,
  changed,
  checkPendingClear,
  isAccountCurrent,
  makeEntry,
  offlineOwner,
  prepareOfflineRecovery,
  PROTOCOL_KEY,
  putEntry,
  requestValue,
  transact,
  type Active,
} from './database.js';
import { freezeParticipants, resumeParticipants } from './coordinator.js';
import { adapters, chargedBytes, type CacheEntry } from './registry.js';
import { reportStorageIssue } from './status.js';

const fail = (message: string): never => {
  throw new Error(message);
};

type ImportState = {
  accountId: string;
  module: 'preview';
  importId: 'v1';
  phase: 'staged' | 'committed' | 'verified';
  source: Record<string, string>;
  entries: CacheEntry[];
  sourceDigest: string;
  targetDigest: string;
  boundary: string | undefined;
};
async function readBoundary(tx: IDBTransaction): Promise<string | undefined> {
  const record = await requestValue<{ value: string } | undefined>(
    tx.objectStore('metadata').get(['__origin__', 'boundary']),
  );
  return record?.value;
}
async function assertImportBoundary(tx: IDBTransaction, state: ImportState) {
  if ((await readBoundary(tx)) !== state.boundary) throw changed();
}
const digest = async (value: unknown) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const sourceEntries = () =>
  Object.fromEntries(
    [...adapters.values()]
      .filter((adapter) => !adapter.separateMigration)
      .flatMap((adapter) => {
        const raw = localStorage.getItem(adapter.legacyKey);
        return raw === null ? [] : [[adapter.legacyKey, raw]];
      }),
  );
function sameSource(state: ImportState, allowRemoved: boolean) {
  if (Object.keys(sourceEntries()).some((key) => !(key in state.source)))
    fail('Pojawiły się nowe dane starej karty. Zamknij starsze karty i ponów aktualizację.');
  for (const [key, raw] of Object.entries(state.source)) {
    const now = localStorage.getItem(key);
    if (now !== raw && !(allowRemoved && now === null))
      fail('Dane starej karty zmieniły się podczas importu. Zamknij starsze karty i ponów aktualizację.');
  }
}
export async function recoverPreviewData(validateAccount?: (account: string) => void) {
  checkPendingClear();
  const token = accountToken();
  // Web Locks serializes new clients. Pre-protocol clients require the explicit maintenance procedure.
  const work = async () => {
    const owner = await offlineOwner(token);
    const states = owner
      ? await transact(
          'readonly',
          async (tx) => requestValue<ImportState[]>(tx.objectStore('migration').getAll()),
          token,
        )
      : [];
    let state = states.find((state) => state.module === 'preview');
    const source = sourceEntries();
    if (!state && !Object.keys(source).length) return;
    if (!navigator.locks?.query)
      fail(
        'Ta przeglądarka nie obsługuje bezpiecznej aktualizacji pamięci. Użyj aktualnej przeglądarki lub aplikacji Android.',
      );
    if (!state && localStorage.getItem(PROTOCOL_KEY) === 'active')
      fail('Starsza karta ponownie zapisała dane po aktualizacji. Zamknij ją i wyloguj się przed dalszą pracą.');
    localStorage.setItem(PROTOCOL_KEY, 'migrating');
    await freezeParticipants();
    if (!state) {
      const entries = [...adapters.values()]
        .filter((adapter) => !adapter.separateMigration)
        .flatMap((adapter) => {
          const raw = source[adapter.legacyKey];
          return raw === undefined ? [] : [makeEntry(adapter.module, adapter.parseCache(JSON.parse(raw)))];
        });
      const accounts = new Set(entries.map((entry) => entry.accountId));
      if (accounts.size !== 1)
        fail('Nie można połączyć danych offline różnych kont. Wyloguj się i pobierz dane ponownie.');
      const accountId = entries[0]!.accountId;
      validateAccount?.(accountId);
      await prepareOfflineRecovery(accountId, token);
      state = {
        accountId,
        module: 'preview',
        importId: 'v1',
        phase: 'staged',
        source,
        entries,
        sourceDigest: await digest(source),
        targetDigest: await digest(entries),
        boundary: await transact('readonly', readBoundary, token),
      };
      if (chargedBytes(accountId, state) > 48 * 1048576)
        fail('Brak miejsca na kopię danych podczas aktualizacji pamięci.');
      const estimate = await navigator.storage?.estimate?.();
      const needed =
        2 *
          (new TextEncoder().encode(JSON.stringify(source)).byteLength +
            new TextEncoder().encode(JSON.stringify(entries)).byteLength) +
        1048576;
      if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < needed)
        fail('Brak miejsca na bezpieczne przeniesienie danych offline. Zwolnij miejsce i ponów próbę.');
      sameSource(state, false);
      const captured = state;
      await transact(
        'readwrite',
        async (tx) => {
          await assertImportBoundary(tx, captured);
          tx.objectStore('migration').put(captured);
        },
        token,
      );
    }
    if ((await digest(state.source)) !== state.sourceDigest || (await digest(state.entries)) !== state.targetDigest)
      fail('Kopia robocza importu jest uszkodzona. Źródło zostało zachowane.');
    if (state.phase === 'staged') {
      sameSource(state, false);
      const captured = state;
      const accountId = state.accountId;
      await transact(
        'readwrite',
        async (tx) => {
          await assertImportBoundary(tx, captured);
          const old = await requestValue<Active | undefined>(tx.objectStore('metadata').get(['__origin__', 'active']));
          if (await requestValue(tx.objectStore('metadata').get(['__origin__', 'suspended']))) throw changed();
          if (old && old.value.accountId !== accountId) throw changed();
          for (const entry of captured.entries) {
            const existing = await requestValue(
              tx.objectStore('cache').getKey([entry.accountId, entry.module, entry.key]),
            );
            if (existing)
              fail(
                'Pamięć IndexedDB zawiera już dane tego modułu. Zamknij starsze karty i zachowaj ich dane do sprawdzenia.',
              );
            putEntry(tx, entry);
          }
          tx.objectStore('migration').put({ ...captured, phase: 'committed' });
          tx.objectStore('metadata').put({
            accountId: '__origin__',
            key: 'active',
            value: old?.value ?? { accountId, generation: crypto.randomUUID() },
          });
        },
        token,
      );
      state = { ...captured, phase: 'committed' };
    }
    const captured = state;
    if (state.phase === 'committed') {
      sameSource(state, false);
      await transact(
        'readwrite',
        async (tx) => {
          await assertImportBoundary(tx, captured);
          for (const expected of captured.entries) {
            const actual = await requestValue<CacheEntry | undefined>(
              tx.objectStore('cache').get([expected.accountId, expected.module, expected.key]),
            );
            if (JSON.stringify(actual) !== JSON.stringify(expected))
              fail('Weryfikacja przeniesionych danych nie powiodła się. Źródło zostało zachowane.');
          }
          tx.objectStore('migration').put({ ...captured, phase: 'verified' });
        },
        token,
      );
    }
    if (!isAccountCurrent(token)) throw changed();
    sameSource(state, true);
    for (const key of Object.keys(state.source)) localStorage.removeItem(key);
    if (Object.keys(state.source).some((key) => localStorage.getItem(key) !== null))
      fail('Nie można usunąć starej kopii danych offline.');
    await transact(
      'readwrite',
      async (tx) => {
        await assertImportBoundary(tx, captured);
        tx.objectStore('migration').delete([captured.accountId, 'preview', 'v1']);
        for (const entry of captured.entries)
          tx.objectStore('metadata').put({
            accountId: entry.accountId,
            key: `engine:${entry.module}`,
            value: 'legacy-idb',
          });
        tx.objectStore('metadata').put({ accountId: captured.accountId, key: 'import:preview:v1', value: 'active' });
      },
      token,
    );
    localStorage.setItem(PROTOCOL_KEY, 'active');
    reportStorageIssue();
    resumeParticipants();
  };
  if (navigator.locks) await navigator.locks.request(PROTOCOL_KEY, work);
  else await work();
}
