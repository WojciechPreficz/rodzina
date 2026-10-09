import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Europe/Warsaw'),
  joinCode: text('join_code').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});

export const users = sqliteTable('users', {
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
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  userAgent: text('user_agent'),
});

export const invitations = sqliteTable('invitations', {
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
});

export const passwordResets = sqliteTable('password_resets', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
});

export const jobRuns = sqliteTable('job_runs', {
  id: text('id').primaryKey(),
  job: text('job').notNull(),
  ranAt: integer('ran_at').notNull(),
});
