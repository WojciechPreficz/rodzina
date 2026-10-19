import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  RODZINA_DATABASE_PATH: z.string().min(1).default('./apps/api/data/rodzina.db'),
  RODZINA_BACKUP_DIR: z.string().trim().min(1).default('./apps/api/data/backups'),
  RODZINA_WEB_DIR: z.string().min(1).default('./public'),
  RODZINA_ANDROID_DOWNLOAD_DIR: z.string().default(''),
  RODZINA_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim().toUpperCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/))),
  RODZINA_ALLOW_REGISTRATION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return environmentSchema.parse(environment);
}
