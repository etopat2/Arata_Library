import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const destination = resolve('.env.foundation.local');
if (existsSync(destination)) {
  const present = readFileSync(destination, 'utf8');
  const additions = ['AUTH_SESSION_SECRET', 'AUTH_DATA_KEY']
    .filter((key) => !new RegExp(`^${key}=`, 'm').test(present))
    .map((key) => `${key}=${randomBytes(32).toString('hex')}`);
  if (additions.length) appendFileSync(destination, `\n${additions.join('\n')}\n`);
  console.info('Existing .env.foundation.local preserved; missing identity keys added.');
} else {
  const token = randomBytes(32).toString('hex');
  writeFileSync(destination, `HEALTH_TOKEN=${token}\nAUTH_SESSION_SECRET=${randomBytes(32).toString('hex')}\nAUTH_DATA_KEY=${randomBytes(32).toString('hex')}\nREDIS_URL=redis://127.0.0.1:6379\nAPI_PORT=3000\nWEB_ORIGIN=http://127.0.0.1:5173\n`, { mode: 0o600, flag: 'wx' });
  console.info('Created ignored .env.foundation.local with a random service health token.');
}
