import { readAccountSession, saveAccountSession, PENDING_LOGOUT_KEY } from './session.js';
import { calendarStore, registerCalendarStore } from './features/calendar/calendarOffline.js';
import { registerTaskStore } from './features/tasks/taskOffline.js';
import { registerShoppingStore } from './features/shopping/shoppingOffline.js';
import { forgetOfflineData } from './offlineData.js';
import { clearDatabase } from './offline/database.js';
import { CONTACTS_STORAGE_KEY, registerContactsStore } from './features/contacts/contactsOffline.js';

import type { AccountServices } from './accountLifecycle.js';
import { registerAccountStore } from './accountStorage.js';
import { accountId, familyMembersKey, hydrateOfflineData, restoreOfflineData, saveOfflineData } from './offlineData.js';
import { listMembers } from './features/family/familyApi.js';
import { localScheduler } from './features/notifications/localSchedule.js';
import { isAndroid } from './platform.js';
import { restoreMeals, stopMeals } from './features/meals/mealOffline.js';

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
  registerAccountStore({
    name: 'meals',
    restore: restoreMeals,
    stop: stopMeals,
    phase: 'before-invalidation',
    clear: stopMeals,
  });
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
    clear: ({ removeStored }) => clearDatabase(removeStored),
  });
}
