import type { ThemeAsset } from '@/lib/themePackage';

/**
 * THEME ASSET STORE (IndexedDB)
 *
 * Why not localStorage, where the rest of the theme preference lives:
 * localStorage is ~5MB TOTAL for the origin, stores strings only, and
 * base64 inflates binary by ~33%. A single 500KB hero image becomes
 * ~665KB of string; two or three themes and the quota is gone. Worse,
 * it fails by throwing mid-write, so you would get a half-saved theme
 * and no obvious cause.
 *
 * IndexedDB stores Blobs natively, has a far larger quota, and is
 * asynchronous, so a large asset does not block the UI thread - which
 * matters on the Pi 2B, where a blocked main thread is visible.
 *
 * Only ASSETS live here. The theme's tokens and the selected-theme id
 * stay in localStorage, because they are small and are needed
 * synchronously on first paint to avoid a flash of the wrong theme.
 *
 * Blob URLs are cached per asset and revoked when a theme is removed or
 * replaced - an un-revoked blob URL is a genuine memory leak that
 * survives navigation.
 */

const DB_NAME = 'vanos-theme-assets';
const DB_VERSION = 1;
const STORE = 'assets';

interface StoredAsset {
  /** `${themeId}::${path}` */
  key: string;
  themeId: string;
  path: string;
  mime: string;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        // Lets a whole theme's assets be found and deleted together.
        store.createIndex('themeId', 'themeId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the theme asset store.'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export async function putThemeAssets(themeId: string, assets: ThemeAsset[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    for (const a of assets) {
      const record: StoredAsset = {
        key: `${themeId}::${a.path}`,
        themeId,
        path: a.path,
        mime: a.mime,
        // Copy into a fresh ArrayBuffer: the Uint8Array from fflate may
        // be a view onto a larger shared buffer, and storing the view
        // would persist the whole thing.
        blob: new Blob([a.bytes.slice().buffer], { type: a.mime }),
      };
      store.put(record);
    }
    t.oncomplete = () => { db.close(); resolve(); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

export async function deleteThemeAssets(themeId: string): Promise<void> {
  revokeThemeUrls(themeId);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const index = t.objectStore(STORE).index('themeId');
    const req = index.openKeyCursor(IDBKeyRange.only(themeId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        t.objectStore(STORE).delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    t.oncomplete = () => { db.close(); resolve(); };
    t.onerror = () => { db.close(); reject(t.error); };
  });
}

/** themeId -> (path -> blob URL). Kept so URLs can be revoked. */
const urlCache = new Map<string, Map<string, string>>();

export async function getThemeAssetUrl(themeId: string, path: string): Promise<string | null> {
  const cached = urlCache.get(themeId)?.get(path);
  if (cached) return cached;

  let record: StoredAsset | undefined;
  try {
    record = await tx<StoredAsset>('readonly', (s) => s.get(`${themeId}::${path}`) as IDBRequest<StoredAsset>);
  } catch {
    return null;
  }
  if (!record) return null;

  const url = URL.createObjectURL(record.blob);
  const forTheme = urlCache.get(themeId) ?? new Map<string, string>();
  forTheme.set(path, url);
  urlCache.set(themeId, forTheme);
  return url;
}

export function revokeThemeUrls(themeId: string): void {
  const forTheme = urlCache.get(themeId);
  if (!forTheme) return;
  for (const url of forTheme.values()) URL.revokeObjectURL(url);
  urlCache.delete(themeId);
}

export function revokeAllThemeUrls(): void {
  for (const id of [...urlCache.keys()]) revokeThemeUrls(id);
}

/** Best-effort quota check before importing, so a package that cannot
 *  fit is refused with a clear message rather than failing mid-write. */
export async function hasRoomFor(bytes: number): Promise<boolean> {
  try {
    if (!navigator.storage?.estimate) return true; // can't tell; let it try
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    if (!quota) return true;
    return quota - usage > bytes * 1.5; // headroom for IndexedDB overhead
  } catch {
    return true;
  }
}
