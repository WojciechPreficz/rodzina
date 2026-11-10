import './testSetup.js';

export {
  activateOfflineAccount,
  clearDatabase,
  closeDatabase,
  readCache,
  requestValue,
  transact,
  writeCache,
} from './database.js';
export { appendOperation, completeOperation, readOperations } from './outbox.js';
export { joinSync, startSync, type SyncAdapter } from './sync.js';
export { offlineTransaction } from './transaction.js';
export { needsLegacyRecovery } from './legacySources.js';
export async function recoverLegacyData() {
  const recovery = await import('./legacyRecovery.js');
  await recovery.recoverLegacyData();
}
