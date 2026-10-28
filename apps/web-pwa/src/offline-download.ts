import type { ApiData, ReaderLesson, ReaderManifest, createApiClient } from '@arata/api-client';
import {
  digestManifest,
  getDeviceId,
  getOfflinePackage,
  listOfflinePackages,
  offlinePackageValidity,
  readOfflineLesson,
  saveOfflinePackage,
  storageEstimate,
  storeOfflineAsset,
  storeOfflineLesson,
  verifyLicence,
  type OfflineLicence,
  type OfflinePackage,
} from './offline-store.js';

type ReaderApi = ReturnType<typeof createApiClient>['reader'];
export async function downloadEdition(
  api: ReaderApi,
  editionId: string,
  onProgress: (done: number, total: number) => void,
) {
  const deviceId = await getDeviceId();
  const existingForEdition = (await listOfflinePackages()).find(
    (item) =>
      item.editionId === editionId && (item.status === 'downloading' || item.status === 'quota'),
  );
  const licence: OfflineLicence = existingForEdition
    ? existingForEdition.licence
    : (await api.createOfflineLicence(editionId, deviceId, crypto.randomUUID())).data;
  if (!(await verifyLicence(licence)))
    throw new Error('The offline licence signature could not be verified.');
  if (Date.parse(licence.expiresAt) <= Date.parse(licence.serverTime))
    throw new Error('The offline licence has already expired. Reconnect and refresh your access.');
  const manifest: ReaderManifest = (await api.manifest(editionId)).data;
  const manifestHash = await digestManifest(editionId, licence.revisionId, licence.lessonIds);
  if (manifestHash !== licence.manifestHash)
    throw new Error('The published reading package changed. Reconnect and try again.');
  const prior = await getOfflinePackage(licence.id);
  const packageRecord: OfflinePackage = prior ?? {
    id: licence.id,
    editionId,
    revisionId: licence.revisionId,
    licence,
    status: 'downloading',
    downloaded: 0,
    total: licence.lessonIds.length,
    createdAt: new Date().toISOString(),
    lastWallClock: Date.now(),
    bytes: 0,
    files: [],
    deferredFiles: [],
  };
  packageRecord.status = 'downloading';
  await saveOfflinePackage(packageRecord);
  const estimate = await storageEstimate();
  if (estimate.quota && estimate.usage / estimate.quota > 0.95) {
    packageRecord.status = 'quota';
    await saveOfflinePackage(packageRecord);
    throw new Error('This device is nearly out of storage. Remove an offline package and retry.');
  }
  const available = new Set(
    manifest.lessons.filter((lesson) => lesson.available).map((lesson) => lesson.id),
  );
  if (licence.lessonIds.some((id) => !available.has(id)))
    throw new Error(
      'One or more licensed lessons are no longer available. Reconnect to refresh access.',
    );
  let complete = 0;
  for (const id of licence.lessonIds) {
    try {
      const storedLesson = await readOfflineLesson(licence.id, id);
      const currentLesson: ReaderLesson = (await api.lesson(id)).data;
      if (!currentLesson.policy.allowOffline) throw new Error('Offline permission was withdrawn.');
      const lesson = storedLesson ?? currentLesson;
      if (!storedLesson) {
        packageRecord.bytes += await storeOfflineLesson(licence.id, lesson);
        packageRecord.downloaded = ++complete;
        packageRecord.lastWallClock = Date.now();
        await saveOfflinePackage(packageRecord);
        onProgress(complete, licence.lessonIds.length);
      } else complete += 1;
      if (
        lesson.hasBodyAsset &&
        lesson.policy.allowDownload &&
        !packageRecord.files?.some((file) => file.lessonId === lesson!.id)
      ) {
        const grant = (await api.assetGrant(lesson.id)).data;
        const response = await fetch(
          `/api/v1/reader/assets/${encodeURIComponent(grant.assetId)}?grant=${encodeURIComponent(grant.token)}`,
          { credentials: 'include', cache: 'no-store' },
        );
        if (!response.ok)
          throw new Error('The separately licensed attachment could not be downloaded.');
        const file = await response.blob();
        if (file.size > 25 * 1024 * 1024) {
          packageRecord.deferredFiles ??= [];
          if (!packageRecord.deferredFiles.some((item) => item.lessonId === lesson.id))
            packageRecord.deferredFiles.push({
              lessonId: lesson.id,
              reason: 'File is larger than the offline media limit.',
            });
        } else {
          const disposition = response.headers.get('content-disposition') ?? '';
          const suppliedName = disposition.match(/filename="([^"]+)"/i)?.[1];
          const safeName = Array.from(suppliedName ?? `lesson-${lesson.id}-attachment`)
            .filter((character) => {
              const code = character.charCodeAt(0);
              return code >= 32 && code !== 127;
            })
            .join('');
          const fileName =
            safeName.split(/[\\/]/).at(-1)?.trim().slice(0, 180) ||
            `lesson-${lesson.id}-attachment`;
          const metadata = {
            id: grant.assetId,
            lessonId: lesson.id,
            fileName,
            mimeType: file.type || 'application/octet-stream',
            bytes: file.size,
          };
          packageRecord.bytes += await storeOfflineAsset(licence.id, metadata, file);
          packageRecord.files ??= [];
          packageRecord.files.push(metadata);
        }
      }
      packageRecord.lastWallClock = Date.now();
      await saveOfflinePackage(packageRecord);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        packageRecord.status = 'quota';
        await saveOfflinePackage(packageRecord);
        throw new Error('Device storage filled during download. Free space and retry to resume.');
      }
      throw error;
    }
  }
  packageRecord.downloaded = complete;
  packageRecord.status = 'ready';
  packageRecord.lastWallClock = Date.now();
  await saveOfflinePackage(packageRecord);
  return packageRecord;
}

export async function usableOfflinePackage(packageId: string) {
  const item = await getOfflinePackage(packageId);
  if (!item || item.status !== 'ready')
    return { item: null, reason: 'This package is incomplete.' };
  const validity = await offlinePackageValidity(item);
  if (!validity.valid) {
    item.status = 'expired';
    await saveOfflinePackage(item);
    return { item: null, reason: validity.reason };
  }
  return { item, reason: '' };
}

export type OfflineApiLesson = ApiData<ReaderLesson>;
export type OfflineApiManifest = ApiData<ReaderManifest>;
