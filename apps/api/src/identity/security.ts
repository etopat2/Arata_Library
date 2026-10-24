import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

const passwordParameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scrypt = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(password, salt, 64, passwordParameters, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

export const randomToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const derived = await scrypt(password, salt);
  return `scrypt-v1:${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const parts = encoded?.split(':');
  const salt =
    parts?.length === 3 && parts[0] === 'scrypt-v1'
      ? Buffer.from(parts[1]!, 'base64url')
      : Buffer.alloc(32);
  const expected =
    parts?.length === 3 && parts[0] === 'scrypt-v1'
      ? Buffer.from(parts[2]!, 'base64url')
      : Buffer.alloc(64);
  const actual = await scrypt(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual) && !!encoded;
}

export function csrfToken(sessionToken: string, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`csrf:${sessionToken}`)
    .digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function seal(value: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `gcm-v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${payload.toString('base64url')}`;
}

export function unseal(value: string, key: string): string {
  const [version, iv, tag, ciphertext] = value.split(':');
  if (version !== 'gcm-v1' || !iv || !tag || !ciphertext)
    throw new Error('Unsupported encrypted credential');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function newTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits
    .match(/.{5}/g)!
    .map((group) => alphabet[parseInt(group, 2)])
    .join('');
}

function decodeBase32(value: string): Buffer {
  let bits = '';
  for (const character of value.toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid TOTP secret');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((group) => parseInt(group, 2)));
}

export function totpAt(secret: string, timestamp: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((step) => safeEqual(totpAt(secret, now + step * 30_000), code));
}
