import type { CapacitorConfig } from '@capacitor/cli';

const apiOrigin = process.env.RODZINA_ANDROID_API_ORIGIN ?? 'https://rodzina.preficze.pl';
if (!['https://rodzina.preficze.pl', 'http://localhost:3000'].includes(apiOrigin)) {
  throw new Error('Unsupported Android API origin.');
}

const config: CapacitorConfig = {
  appId: 'pl.preficze.rodzina',
  appName: 'Rodzina',
  loggingBehavior: 'none',
  webDir: 'apps/web/dist-android',
  server: { androidScheme: 'https' },
  plugins: { RodzinaApi: { apiOrigin } },
};

export default config;
