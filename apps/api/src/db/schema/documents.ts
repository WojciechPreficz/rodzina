import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { DocumentType } from '@rodzina/shared';
import { families, users } from './family.js';

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    type: text('type').$type<DocumentType>().notNull(),
    label: text('label').notNull(),
    holderUserId: text('holder_user_id').references(() => users.id, { onDelete: 'set null' }),
    vehicleLabel: text('vehicle_label'),
    expiresOn: text('expires_on').notNull(),
    notes: text('notes'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('documents_family_expiry_idx').on(table.familyId, table.expiresOn),
    index('documents_created_by_idx').on(table.createdBy),
  ],
);
