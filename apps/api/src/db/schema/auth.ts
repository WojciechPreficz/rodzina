import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './family.js';

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    userAgent: text('user_agent'),
  },
  (table) => [index('sessions_user_idx').on(table.userId), index('sessions_expiry_idx').on(table.expiresAt)],
);

export const authRateLimits = sqliteTable(
  'auth_rate_limits',
  {
    scopeKey: text('scope_key').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('auth_rate_limits_expiry_idx').on(table.expiresAt)],
);

export const passwordResets = sqliteTable(
  'password_resets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (table) => [index('password_resets_expiry_idx').on(table.expiresAt)],
);

export const pendingRegistrations = sqliteTable(
  'pending_registrations',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    familyName: text('family_name').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    ready: integer('ready', { mode: 'boolean' }).notNull().default(false),
  },
  (table) => [
    index('pending_registrations_email_idx').on(table.email),
    index('pending_registrations_expiry_idx').on(table.expiresAt),
  ],
);
