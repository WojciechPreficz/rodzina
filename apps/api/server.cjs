const path = require('node:path');
const os = require('node:os');

const envFile = process.env.RODZINA_ENV_FILE ?? path.join(os.homedir(), 'rodzina-data', '.env');

try {
  process.loadEnvFile(envFile);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  if (process.env.NODE_ENV === 'production') throw error;
}

import('./dist/server.js').catch((error) => {
  console.error('Nie udało się uruchomić API:', error);
  process.exitCode = 1;
});
