export type CacheModule = 'family' | 'calendar' | 'shopping';
export type CacheEntry = {
  accountId: string;
  module: CacheModule;
  key: string;
  schemaVersion: 1;
  payload: unknown;
  syncedAt: number | null;
  coverage: 'missing' | 'partial' | 'complete';
  usedAt: number;
  chargedBytes: number;
};
export type OfflineAdapter = {
  module: CacheModule;
  schemaVersion: 1;
  capabilities: 'read-only';
  legacyKey: string;
  budget: number;
  parseCache: (value: unknown) => { account: string };
  trim: (value: unknown, fits: (value: unknown) => boolean) => unknown;
  describe: (value: unknown) => Pick<CacheEntry, 'syncedAt' | 'coverage'>;
};
export const adapters = new Map<CacheModule, OfflineAdapter>();
export function registerAdapter(adapter: OfflineAdapter) {
  if (adapters.has(adapter.module)) throw new Error(`Duplicate offline adapter: ${adapter.module}`);
  adapters.set(adapter.module, adapter);
}
export const chargedBytes = (key: unknown, value: unknown) =>
  2 * new TextEncoder().encode(JSON.stringify([key, value])).byteLength + 256;
