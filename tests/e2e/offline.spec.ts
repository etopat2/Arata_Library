import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { test, expect, type Browser } from '@playwright/test';

const editionId = 'af2d3f9a-7ee0-47f3-995e-df74c18aa10a';
const lessonId = 'bf2d3f9a-7ee0-47f3-995e-df74c18aa10b';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
const manifestHash = createHash('sha256')
  .update(
    JSON.stringify({
      editionId,
      revisionId: 'cf2d3f9a-7ee0-47f3-995e-df74c18aa10c',
      lessons: [{ id: lessonId }],
    }),
  )
  .digest('hex');
const body = {
  id: 'df2d3f9a-7ee0-47f3-995e-df74c18aa10d',
  editionId,
  revisionId: 'cf2d3f9a-7ee0-47f3-995e-df74c18aa10c',
  manifestHash,
  lessonIds: [lessonId],
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  revokedAt: null,
  serverTime: new Date().toISOString(),
  formatVersion: 1,
};
const signedLicense = {
  ...body,
  signature: sign(null, Buffer.from(JSON.stringify(body)), privateKey).toString('base64url'),
  publicKey: publicKeyBase64,
};
const lesson = {
  id: lessonId,
  title: 'Offline test lesson',
  ordinal: 1,
  chapterId: 'ef2d3f9a-7ee0-47f3-995e-df74c18aa10e',
  chapterTitle: 'Test chapter',
  chapterOrdinal: 1,
  editionId,
  editionLabel: 'Development edition',
  revisionNumber: 1,
  publicationTitle: '[TEST ONLY] Offline sample',
  publicationSlug: 'offline-test',
  bodyMarkdown: 'This is encrypted offline text.',
  blocks: [],
  hasBodyAsset: false,
  policy: {
    accessClass: 'PREMIUM',
    allowRead: true,
    allowPreview: false,
    allowSelect: true,
    allowCopy: false,
    maxCopyChars: 0,
    allowPrint: false,
    allowDownload: false,
    allowExportPdf: false,
    allowExportEpub: false,
    allowOffline: true,
    allowShare: false,
    watermark: false,
    screenshotMode: 'ALLOW',
    sessionLimits: [],
  },
  watermark: null,
  screenshotNotice: null,
};

async function mockOfflineApi(page: import('@playwright/test').Page, onLicenseIssued?: () => void) {
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/health/live')) return route.fulfill({ json: { data: { status: 'ok' } } });
    if (path.endsWith('/reader/settings'))
      return route.fulfill({ status: 401, json: { title: 'Unauthorized', status: 401 } });
    if (path.endsWith(`/reader/editions/${editionId}/manifest`))
      return route.fulfill({
        json: {
          data: {
            editionId,
            lessons: [
              {
                id: lessonId,
                title: lesson.title,
                chapterId: lesson.chapterId,
                chapterTitle: lesson.chapterTitle,
                chapterOrdinal: 1,
                ordinal: 1,
                available: true,
                preview: false,
              },
            ],
          },
          requestId: 'test',
        },
      });
    if (path.endsWith(`/reader/lessons/${lessonId}`))
      return route.fulfill({ json: { data: lesson, requestId: 'test' } });
    if (path.includes('/annotations') || path.endsWith('/bookmarks') || path.endsWith('/progress'))
      return route.fulfill({ json: { data: [], requestId: 'test' } });
    if (path.endsWith('/reader/offline-licenses') && route.request().method() === 'POST') {
      onLicenseIssued?.();
      return route.fulfill({ status: 201, json: { data: signedLicense, requestId: 'test' } });
    }
    if (path.includes('/catalogue/publications/'))
      return route.fulfill({ status: 404, json: { title: 'Not found', status: 404 } });
    return route.fulfill({ status: 404, json: { title: 'Not found', status: 404 } });
  });
}

async function exerciseOfflineReader(
  browser: Browser,
  viewport: { width: number; height: number },
  mobile: boolean,
) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  await page.clock.install({ time: new Date() });
  await mockOfflineApi(page);
  await page.goto(`/?screen=reader&edition=${editionId}&lesson=${lessonId}`);
  await expect(page.getByRole('heading', { name: lesson.title })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: 'Download for offline reading' }).click();
  await expect(page.getByText('Available offline')).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: lesson.title })).toBeVisible();
  await expect(page.getByText(/Offline reading is active/)).toBeVisible();
  await page.route('**/api/v1/reader/**', (route) => route.abort());
  await page.getByRole('button', { name: 'Bookmark' }).click();
  await expect(page.getByText(/Saved on this device/)).toBeVisible();
  const queued = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('arata-offline-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<{ secure: unknown[]; legacy: unknown[] }>((resolve, reject) => {
      const tx = db.transaction(['secureChanges', 'changes'], 'readonly');
      const secure = tx.objectStore('secureChanges').getAll();
      const legacy = tx.objectStore('changes').getAll();
      tx.oncomplete = () => resolve({ secure: secure.result, legacy: legacy.result });
      tx.onerror = () => reject(tx.error);
    });
  });
  expect(queued.secure).toHaveLength(1);
  expect(JSON.stringify(queued.secure)).not.toContain('anchor');
  expect(queued.legacy).toHaveLength(0);
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(
    page.getByRole('group', { name: 'Confirm removal of unsynced changes' }),
  ).toBeVisible();
  await expect(page.getByText(/1 unsynced change\(s\) will be discarded/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep package' }).click();
  const clockTime = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(clockTime - 60 * 60_000));
  await page.reload();
  await expect(page.getByText(/Device time moved backwards/)).toBeVisible();
  await page.clock.setFixedTime(new Date(clockTime + 2 * 86_400_000));
  await page.reload();
  await expect(page.getByText('Licence expired')).toBeVisible();
  await expect(page.getByRole('heading', { name: lesson.title })).toHaveCount(0);
  await context.setOffline(false);
  await context.close();
}

test('offline licence package downloads and opens on desktop Chromium', async ({ browser }) => {
  await exerciseOfflineReader(browser, { width: 1440, height: 900 }, false);
});

test('offline licence package downloads and opens on a mobile browser viewport', async ({
  browser,
}) => {
  await exerciseOfflineReader(browser, { width: 390, height: 844 }, true);
});

test('interrupted package download exposes a retry state after storage is exhausted', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  let issueCount = 0;
  await page.addInitScript(() => {
    let injected = false;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'lessons' && !injected) {
        injected = true;
        throw new DOMException('synthetic quota exhaustion', 'QuotaExceededError');
      }
      return Reflect.apply(
        original,
        this,
        key === undefined ? [value] : [value, key],
      ) as IDBRequest<IDBValidKey>;
    };
  });
  await mockOfflineApi(page, () => issueCount++);
  await page.goto(`/?screen=reader&edition=${editionId}&lesson=${lessonId}`);
  await expect(page.getByRole('heading', { name: lesson.title })).toBeVisible();
  await page.getByRole('button', { name: 'Download for offline reading' }).click();
  await expect(page.getByText(/Device storage filled during download/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume offline download' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume offline download' }).click();
  await expect(page.getByText('Available offline')).toBeVisible();
  expect(issueCount).toBe(1);
  await context.close();
});
