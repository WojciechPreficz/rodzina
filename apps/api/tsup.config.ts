import { defineConfig } from 'tsup';

export default defineConfig({
  noExternal: ['@rodzina/shared', 'rrule', 'date-fns', '@date-fns/tz'],
});
