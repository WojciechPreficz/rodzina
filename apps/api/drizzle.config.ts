import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './apps/api/src/db/schema.ts',
  out: './apps/api/drizzle',
  dbCredentials: {
    url: process.env.RODZINA_DATABASE_PATH ?? './apps/api/data/rodzina.db',
  },
});
