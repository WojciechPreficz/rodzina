import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const jobRuns = sqliteTable('job_runs', {
  id: text('id').primaryKey(),
  job: text('job').notNull(),
  ranAt: integer('ran_at').notNull(),
});
