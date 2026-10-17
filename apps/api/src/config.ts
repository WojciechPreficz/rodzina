import { z } from 'zod';
import { createECDH } from 'node:crypto';

const base64urlKey = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine(
      (value) =>
        Buffer.from(value, 'base64url').length === bytes &&
        Buffer.from(value, 'base64url').toString('base64url') === value,
      'Invalid VAPID key',
    );

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    RODZINA_DATABASE_PATH: z.string().min(1).default('./apps/api/data/rodzina.db'),
    RODZINA_BACKUP_DIR: z.string().trim().min(1).default('./apps/api/data/backups'),
    RODZINA_WEB_DIR: z.string().min(1).default('./public'),
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
    RODZINA_VAPID_PUBLIC_KEY: base64urlKey(65),
    RODZINA_VAPID_PRIVATE_KEY: base64urlKey(32),
    RODZINA_VAPID_SUBJECT: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (url.protocol === 'mailto:' && /^[^\s@]+@[^\s@]+$/.test(url.pathname)) || url.protocol === 'https:';
      }, 'Expected a mailto or HTTPS contact'),
  })
  .superRefine((value, context) => {
    try {
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(Buffer.from(value.RODZINA_VAPID_PRIVATE_KEY, 'base64url'));
      if (ecdh.getPublicKey().toString('base64url') === value.RODZINA_VAPID_PUBLIC_KEY) return;
    } catch {
      /* Invalid private scalar. */
    }
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RODZINA_VAPID_PUBLIC_KEY'],
      message: 'VAPID keys must form a P-256 key pair',
    });
  });

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return environmentSchema.parse(environment);
}
