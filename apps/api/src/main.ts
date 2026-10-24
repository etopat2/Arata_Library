import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createApp, loadConfig } from './app.js';

config({
  path: resolve(process.cwd(), '../..', process.env.ARATA_ENV_FILE ?? '.env.local'),
  quiet: true,
});
config({ path: resolve(process.cwd(), '../../.env.foundation.local'), quiet: true });
config({ path: resolve(process.cwd(), '../../.env.redis.local'), quiet: true, override: true });

const settings = loadConfig();
const app = await createApp();
await app.listen(settings.API_PORT, settings.API_HOST);
console.info(JSON.stringify({ event: 'api.started', port: settings.API_PORT }));
