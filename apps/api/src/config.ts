import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  RODZINA_DATABASE_PATH: z.string().min(1).default('./apps/api/data/rodzina.db'),
  RODZINA_BACKUP_DIR: z.string().trim().min(1).default('./apps/api/data/backups'),
  RODZINA_WEB_DIR: z.string().min(1).default('./public'),
  RODZINA_ANDROID_DOWNLOAD_DIR: z.string().default(''),
  RODZINA_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  RODZINA_TRUSTED_PROXIES: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean),
    ),
  RODZINA_PASSWORD_RESET_EMAIL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  RODZINA_SMTP_HOST: z.string().trim().default(''),
  RODZINA_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  RODZINA_SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  RODZINA_SMTP_USER: z.string().trim().default(''),
  RODZINA_SMTP_PASSWORD: z.string().default(''),
  RODZINA_MAIL_FROM: z.string().trim().default(''),
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
  const config = environmentSchema.parse(environment);
  if (config.RODZINA_PASSWORD_RESET_EMAIL_ENABLED) {
    if (
      !config.RODZINA_SMTP_HOST ||
      !config.RODZINA_SMTP_USER ||
      !config.RODZINA_SMTP_PASSWORD ||
      !z.string().email().safeParse(config.RODZINA_MAIL_FROM).success
    ) {
      throw new Error('Password reset email requires complete SMTP configuration and a sender email address.');
    }
    const url = new URL(config.RODZINA_PUBLIC_URL);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (config.NODE_ENV === 'production' ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))
    ) {
      throw new Error('Password reset requires a public origin URL (HTTPS in production).');
    }
  }
  return config;
}
