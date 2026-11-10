import { readAccountSession, saveAccountSession, PENDING_LOGOUT_KEY } from './session.js';
import { calendarStore, registerCalendarStore } from './features/calendar/calendarOffline.js';
import { registerTaskStore, taskStore } from './features/tasks/index.js';
import { registerShoppingStore } from './features/shopping/index.js';
import { forgetOfflineData } from './offlineData.js';
import { clearDatabase } from './offline/database.js';
import { CONTACTS_STORAGE_KEY, registerContactsStore } from './features/contacts/index.js';

import type { AccountServices } from './accountLifecycle.js';
import { registerAccountStore } from './accountStorage.js';
import { accountId, familyMembersKey, hydrateOfflineData, restoreOfflineData, saveOfflineData } from './offlineData.js';
import { listMembers } from './features/family/index.js';
import { localScheduler } from './reminders/localSchedule.js';
import { isAndroid } from './platform.js';
import { registerMealsStore } from './features/meals/mealOffline.js';
import { synchronizeAccountOutbox } from './offline/sync.js';

export async function synchronizeAccountChanges(account: string) {
  // Tasks verify current list visibility before joining the shared sender.
  if (taskStore.getSnapshot().account === account) await taskStore.synchronize();
  await synchronizeAccountOutbox(account);
}

export const accountServices: AccountServices = {
  accountId,
  familyMembersKey,
  hydrateOfflineData,
  restoreOfflineData,
  saveOfflineData,
  listMembers,
  readSession: readAccountSession,
  saveSession: saveAccountSession,
  pendingLogoutKey: PENDING_LOGOUT_KEY,
  invalidateAlarms: () => {
    if (isAndroid()) localScheduler.invalidate();
  },
  migrationCompleted: calendarStore.clear,
  foreignStorage: (event: StorageEvent, identity: string | undefined) => {
    if (event.key !== CONTACTS_STORAGE_KEY) return false;
    try {
      const account = event.newValue ? JSON.parse(event.newValue)?.account : undefined;
      return !event.newValue || (typeof account === 'string' && account !== identity);
    } catch {
      return false;
    }
  },
};
let registered = false;
export function registerApplicationStores() {
  if (registered) return;
  registered = true;
  registerContactsStore();

  registerCalendarStore();
  registerTaskStore();
  registerShoppingStore();
  registerMealsStore();
  registerAccountStore({
    name: 'offline-data',
    phase: 'before-invalidation',
    clear: () => {
      forgetOfflineData();
    },
  });
  registerAccountStore({
    name: 'indexed-db',
    phase: 'before-invalidation',
    clear: ({ reason, removeStored }) =>
      clearDatabase(
        removeStored,
        reason === 'session-lost' || reason === 'logout-checked'
          ? 'session-lost'
          : reason === 'account-changed'
            ? 'sign-in'
            : 'yes',
      ),
  });
}
