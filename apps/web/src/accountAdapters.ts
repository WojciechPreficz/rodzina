import { calendarStore } from './features/calendar/calendarOffline.js';
import { taskStore } from './features/tasks/taskOffline.js';
import {
  clearShoppingStorage,
  stopShoppingPersistence,
  restoreShopping,
  readShoppingSession,
  PENDING_LOGOUT_KEY,
} from './features/shopping/shoppingOffline.js';
import { forgetOfflineData } from './offlineData.js';
import { clearDatabase } from './offline/database.js';
import { contactsStore } from './features/contacts/contactsOffline.js';

import type { AccountServices } from './accountLifecycle.js';
import { registerAccountStore } from './accountStorage.js';
import { accountId, familyMembersKey, hydrateOfflineData, restoreOfflineData, saveOfflineData } from './offlineData.js';
import { listMembers } from './features/family/familyApi.js';
import { localScheduler } from './features/notifications/localSchedule.js';
import { isAndroid } from './platform.js';
import { CONTACTS_STORAGE_KEY } from './features/contacts/contactsOffline.js';
import { restoreMeals, stopMeals } from './features/meals/mealOffline.js';

export const accountServices: AccountServices = {
  accountId,
  familyMembersKey,
  hydrateOfflineData,
  restoreOfflineData,
  saveOfflineData,
  listMembers,
  readFallbackSession: readShoppingSession,
  pendingLogoutKey: PENDING_LOGOUT_KEY,
  invalidateAlarms: () => {
    if (isAndroid()) localScheduler.invalidate();
  },
  migrationCompleted: () => calendarStore.clear(false),
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
  registerAccountStore({
    name: 'contacts',
    stop: () => contactsStore.clear(false),
    activate: (account) => contactsStore.activate(account),
    phase: 'before-invalidation',
    clear: () => contactsStore.clear(false),
  });

  registerAccountStore({
    name: 'calendar',
    stop: () => calendarStore.clear(false),
    activate: (account) => calendarStore.activate(account),
    phase: 'before-invalidation',
    clear: ({ removeStored }) => calendarStore.clear(removeStored),
  });
  registerAccountStore({
    name: 'tasks',
    stop: () => taskStore.clear(false),
    activate: (account) => taskStore.activate(account),
    phase: 'before-invalidation',
    clear: () => taskStore.clear(false),
  });
  registerAccountStore({
    name: 'shopping',
    restore: restoreShopping,
    stop: (client) => {
      if (client) stopShoppingPersistence(client);
    },
    clear: ({ removeStored, queryClient }) => {
      if (removeStored) clearShoppingStorage(queryClient);
      else if (queryClient) stopShoppingPersistence(queryClient);
    },
  });
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
