import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = resolve('.env.foundation.local');
if (existsSync(destination)) {
  console.info('Existing .env.foundation.local preserved.');
} else {
  const token = randomBytes(32).toString('hex');
  writeFileSync(destination, `HEALTH_TOKEN=${token}\nREDIS_URL=redis://127.0.0.1:6379\nAPI_PORT=3000\nWEB_ORIGIN=http://127.0.0.1:5173\n`, { mode: 0o600, flag: 'wx' });
  console.info('Created ignored .env.foundation.local with a random service health token.');
}
