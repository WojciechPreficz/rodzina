import { z } from 'zod';

export const androidReleaseSchema = z
  .object({
    versionCode: z.number().int().positive().max(2100000000),
    versionName: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
      .max(80),
    apkUrl: z.string().url().max(512),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .transform((value) => value.toLowerCase()),
  })
  .strict();

export type AndroidRelease = z.infer<typeof androidReleaseSchema>;

export function parseAndroidRelease(value: unknown, origin: string): AndroidRelease {
  const release = androidReleaseSchema.parse(value);
  const url = new URL(release.apkUrl);
  if (
    url.protocol !== 'https:' ||
    url.href !== release.apkUrl ||
    url.origin !== new URL(origin).origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/downloads/android/rodzina-${release.versionCode}-${release.versionName}.apk`
  ) {
    throw new Error('Invalid APK URL.');
  }
  return release;
}

export const hasNewAndroidVersion = (installed: number, release: AndroidRelease) => release.versionCode > installed;
