import { openDB, type IDBPDatabase } from 'idb';
import type { ReaderLesson } from '@arata/api-client';

export interface OfflineLicence {
  id: string;
  editionId: string;
  revisionId: string;
  manifestHash: string;
  lessonIds: string[];
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  serverTime: string;
  formatVersion: number;
  signature: string;
  publicKey: string;
}
export interface OfflinePackage {
  id: string;
  editionId: string;
  revisionId: string;
  licence: OfflineLicence;
  status: 'downloading' | 'ready' | 'quota' | 'expired';
  downloaded: number;
  total: number;
  createdAt: string;
  lastWallClock: number;
  bytes: number;
  files?: OfflineFileMeta[];
  deferredFiles?: { lessonId: string; reason: string }[];
}
export interface OfflineFileMeta {
  id: string;
  lessonId: string;
  fileName: string;
  mimeType: string;
  bytes: number;
}
export interface PendingChange {
  id: string;
  licenseId: string;
  deviceId: string;
  kind: 'progress' | 'bookmark' | 'annotation';
  clientUpdatedAt: string;
  entityId: string;
  operation: 'upsert' | 'delete';
  content?: Record<string, unknown>;
  percent?: number;
}
interface EncryptedRecord {
  key: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  bytes: number;
}
interface EncryptedChangeRecord {
  id: string;
  deviceId: string;
  licenseId: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  bytes: number;
}
interface OfflineDB {
  packages: OfflinePackage;
  lessons: EncryptedRecord;
  changes: PendingChange;
  secureChanges: EncryptedChangeRecord;
  secrets: CryptoKey;
  state: EncryptedRecord;
  files: EncryptedRecord;
}

const dbPromise = openDB<OfflineDB>('arata-offline-v1', 4, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('packages'))
      db.createObjectStore('packages', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('lessons'))
      db.createObjectStore('lessons', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('changes'))
      db.createObjectStore('changes', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('secureChanges'))
      db.createObjectStore('secureChanges', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('secrets')) db.createObjectStore('secrets');
    if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
  },
});
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: string) => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) =>
    char.charCodeAt(0),
  );
};

async function database(): Promise<IDBPDatabase<OfflineDB>> {
  return dbPromise;
}
async function encryptionKey() {
  const db = await database();
  let key = await db.get('secrets', 'package-key');
  if (!key) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await db.put('secrets', key, 'package-key');
  }
  return key;
}
function licensePayload(licence: OfflineLicence) {
  const {
    id,
    editionId,
    revisionId,
    manifestHash,
    lessonIds,
    issuedAt,
    expiresAt,
    revokedAt,
    serverTime,
    formatVersion,
  } = licence;
  return JSON.stringify({
    id,
    editionId,
    revisionId,
    manifestHash,
    lessonIds,
    issuedAt,
    expiresAt,
    revokedAt,
    serverTime,
    formatVersion,
  });
}
export async function verifyLicence(licence: OfflineLicence) {
  if (licence.formatVersion !== 1 || licence.revokedAt) return false;
  try {
    const publicKey = await crypto.subtle.importKey(
      'spki',
      bytes(licence.publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      bytes(licence.signature),
      encoder.encode(licensePayload(licence)),
    );
  } catch {
    return false;
  }
}
export async function getDeviceId(): Promise<string> {
  const db = await database();
  let id = (await db.get('secrets', 'device-id')) as unknown as string | undefined;
  if (!id) {
    id = crypto.randomUUID();
    await db.put('secrets', id as unknown as CryptoKey, 'device-id');
  }
  return id;
}
export async function listOfflinePackages() {
  return (await database()).getAll('packages');
}
export async function getOfflinePackage(id: string) {
  return (await database()).get('packages', id);
}
export async function saveOfflinePackage(item: OfflinePackage) {
  await (await database()).put('packages', item);
}
export async function storeOfflineLesson(packageId: string, lesson: ReaderLesson) {
  const key = `${packageId}:${lesson.id}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    encoder.encode(JSON.stringify(lesson)),
  );
  const record = {
    key,
    iv: iv.buffer,
    ciphertext: cipher,
    bytes: cipher.byteLength + iv.byteLength,
  };
  await (await database()).put('lessons', record);
  return record.bytes;
}
async function storeEncryptedState(key: string, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    encoder.encode(JSON.stringify(value)),
  );
  await (
    await database()
  ).put('state', { key, iv: iv.buffer, ciphertext, bytes: ciphertext.byteLength + iv.byteLength });
}
async function readEncryptedState<T>(key: string): Promise<T | undefined> {
  const record = await (await database()).get('state', key);
  if (!record) return undefined;
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: record.iv },
    await encryptionKey(),
    record.ciphertext,
  );
  return JSON.parse(decoder.decode(plain)) as T;
}
export async function storeOfflineReaderState(packageId: string, value: unknown) {
  return storeEncryptedState(`reader:${packageId}`, value);
}
export async function readOfflineReaderState<T>(packageId: string) {
  return readEncryptedState<T>(`reader:${packageId}`);
}
export async function readOfflineLesson(packageId: string, lessonId: string) {
  const record = await (await database()).get('lessons', `${packageId}:${lessonId}`);
  if (!record) return undefined;
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: record.iv },
    await encryptionKey(),
    record.ciphertext,
  );
  return JSON.parse(decoder.decode(plain)) as ReaderLesson;
}
export async function storeOfflineAsset(packageId: string, file: OfflineFileMeta, content: Blob) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    await content.arrayBuffer(),
  );
  const record = {
    key: `${packageId}:${file.id}`,
    iv: iv.buffer,
    ciphertext,
    bytes: ciphertext.byteLength + iv.byteLength,
  };
  await (await database()).put('files', record);
  return record.bytes;
}
let changeMigration: Promise<void> | undefined;
export function migratePendingChanges() {
  changeMigration ??= (async () => {
    const db = await database();
    const previous = await db.getAll('changes');
    if (!previous.length) return;
    const encrypted = await Promise.all(
      previous.map(async (change) => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          await encryptionKey(),
          encoder.encode(JSON.stringify(change)),
        );
        return {
          id: change.id,
          deviceId: change.deviceId,
          licenseId: change.licenseId,
          iv: iv.buffer,
          ciphertext,
          bytes: ciphertext.byteLength + iv.byteLength,
        } satisfies EncryptedChangeRecord;
      }),
    );
    const tx = db.transaction(['changes', 'secureChanges'], 'readwrite');
    for (const record of encrypted) await tx.objectStore('secureChanges').put(record);
    for (const change of previous) await tx.objectStore('changes').delete(change.id);
    await tx.done;
  })().catch((error) => {
    changeMigration = undefined;
    throw error;
  });
  return changeMigration;
}
export async function readOfflineAsset(packageId: string, file: OfflineFileMeta) {
  const record = await (await database()).get('files', `${packageId}:${file.id}`);
  if (!record) return undefined;
  const content = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: record.iv },
    await encryptionKey(),
    record.ciphertext,
  );
  return new Blob([content], { type: file.mimeType });
}
export async function removeOfflinePackage(packageId: string) {
  const db = await database();
  const tx = db.transaction(['packages', 'lessons', 'state', 'files'], 'readwrite');
  for (const record of await tx.objectStore('lessons').getAll())
    if (record.key.startsWith(`${packageId}:`)) await tx.objectStore('lessons').delete(record.key);
  for (const record of await tx.objectStore('files').getAll())
    if (record.key.startsWith(`${packageId}:`)) await tx.objectStore('files').delete(record.key);
  await tx.objectStore('packages').delete(packageId);
  await tx.objectStore('state').delete(`reader:${packageId}`);
  await tx.done;
}
export async function queueOfflineChange(change: PendingChange) {
  await migratePendingChanges();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await encryptionKey(),
    encoder.encode(JSON.stringify(change)),
  );
  await (
    await database()
  ).put('secureChanges', {
    id: change.id,
    deviceId: change.deviceId,
    licenseId: change.licenseId,
    iv: iv.buffer,
    ciphertext,
    bytes: ciphertext.byteLength + iv.byteLength,
  });
}
export async function listPendingChanges(deviceId: string, licenseId?: string) {
  await migratePendingChanges();
  const records = await (await database()).getAll('secureChanges');
  const matches = records.filter(
    (record) => record.deviceId === deviceId && (!licenseId || record.licenseId === licenseId),
  );
  return Promise.all(
    matches.map(async (record) => {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv },
        await encryptionKey(),
        record.ciphertext,
      );
      return JSON.parse(decoder.decode(plain)) as PendingChange;
    }),
  );
}
export async function removePendingChanges(ids: string[]) {
  await migratePendingChanges();
  const db = await database();
  const tx = db.transaction('secureChanges', 'readwrite');
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}
export async function offlinePackageValidity(item: OfflinePackage, now = Date.now()) {
  if (!(await verifyLicence(item.licence)))
    return { valid: false, reason: 'Licence integrity could not be verified.' };
  if (now < item.lastWallClock)
    return {
      valid: false,
      reason: 'Device time moved backwards. Reconnect to verify this licence.',
    };
  item.lastWallClock = now;
  await saveOfflinePackage(item);
  const serverNow =
    Date.parse(item.licence.serverTime) + Math.max(0, now - Date.parse(item.createdAt));
  if (
    Date.now() >= Date.parse(item.licence.expiresAt) ||
    serverNow >= Date.parse(item.licence.expiresAt)
  )
    return { valid: false, reason: 'Offline licence expired. Reconnect to refresh your access.' };
  return { valid: true as const, reason: '' };
}
export async function storageEstimate() {
  const estimate = await navigator.storage?.estimate?.();
  return { usage: estimate?.usage ?? 0, quota: estimate?.quota ?? 0 };
}
export async function digestManifest(editionId: string, revisionId: string, lessonIds: string[]) {
  const sorted = [...lessonIds];
  const encoded = encoder.encode(
    JSON.stringify({ editionId, revisionId, lessons: sorted.map((id) => ({ id })) }),
  );
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
