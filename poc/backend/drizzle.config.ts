import { defineConfig } from 'drizzle-kit';

/**
 * M0-06 – the pinned Drizzle Kit owns the migration file names and its own
 * `drizzle.__drizzle_migrations` journal. There is no hand-maintained
 * numbering and no separate application-side migration log.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: false,
});
