import { loadContactsRecovery } from '../features/contacts/index.js';
import { loadShoppingRecovery } from '../features/shopping/index.js';
import { loadTaskRecovery } from '../features/tasks/index.js';
import { recoverPreviewData } from './previewRecovery.js';

export async function recoverLegacyData() {
  const [{ recoverContacts }, { recoverShopping, validateShoppingRecoveryAccount }, { recoverTasks }] =
    await Promise.all([loadContactsRecovery(), loadShoppingRecovery(), loadTaskRecovery()]);
  await recoverPreviewData(validateShoppingRecoveryAccount);
  await recoverContacts();
  await recoverShopping();
  await recoverTasks();
}
