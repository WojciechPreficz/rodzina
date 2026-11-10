export {
  CONTACTS_STORAGE_KEY,
  contactsStore,
  createContactsStore,
  parseContactsSnapshot,
  registerContactsStore,
} from './contactsOffline.js';
export { ContactsPage } from './ContactsPage.js';
export const loadContactsRecovery = () => import('./contactsRecovery.js');
