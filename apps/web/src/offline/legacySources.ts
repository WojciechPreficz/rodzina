import { hasPendingClear, requestValue, transact } from './database.js';
import { adapters } from './registry.js';

export function isLegacySource(key: string) {
  for (const { module, legacyKey } of adapters.values()) {
    if (module === 'meals') continue;
    if (key === legacyKey) return true;
    if (module === 'tasks' && key.startsWith(`${legacyKey}:`)) return true;
    if (module === 'shopping' && key.startsWith(`${legacyKey}:operation:`)) return true;
  }
  return false;
}

export async function needsLegacyRecovery() {
  // An account clear that has already been requested takes precedence over recovery.
  if (hasPendingClear()) return false;
  if (Object.keys(localStorage).some(isLegacySource)) return true;
  // A verified import can have removed its source just before the tab closed.
  return transact('readonly', async (tx) => (await requestValue(tx.objectStore('migration').count())) > 0);
}
