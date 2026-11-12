import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Europe/Warsaw'),
  joinCode: text('join_code').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    email: text('email').unique(),
    passwordHash: text('password_hash'),
    pinHash: text('pin_hash'),
    role: text('role', { enum: ['admin', 'member', 'child'] })
      .notNull()
      .default('member'),
    color: text('color').notNull().default('#5c7cfa'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('users_family_idx').on(table.familyId)],
);

export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [
    index('invitations_expiry_idx').on(table.expiresAt),
    index('invitations_created_by_idx').on(table.createdBy),
  ],
);

export const invitationEmailVerifications = sqliteTable(
  'invitation_email_verifications',
  {
    tokenHash: text('token_hash').primaryKey(),
    invitationId: text('invitation_id')
      .notNull()
      .references(() => invitations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    index('invitation_email_verifications_invitation_idx').on(table.invitationId),
    index('invitation_email_verifications_expiry_idx').on(table.expiresAt),
  ],
);
