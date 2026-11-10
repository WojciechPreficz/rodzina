import { createRecordRecovery } from '../../offline/index.js';
import { CONTACTS_STORAGE_KEY, parseContactsSnapshot } from './contactsOffline.js';

export const recoverContacts = createRecordRecovery(
  'contacts',
  CONTACTS_STORAGE_KEY,
  (source) => {
    if (Object.keys(source).length !== 1 || !(CONTACTS_STORAGE_KEY in source))
      throw new Error('Nieobsługiwany format pamięci kontaktów.');
    return parseContactsSnapshot(JSON.parse(source[CONTACTS_STORAGE_KEY]!));
  },
  (tx, value) => tx.commitSnapshot('contacts', value, { engine: 'legacy-idb' }),
);
