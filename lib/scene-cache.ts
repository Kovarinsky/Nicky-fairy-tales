const DB_NAME = "nicky-scenes";
const DB_VERSION = 1;
const STORE = "rendered";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheStory(
  id: string,
  scenes: Array<{ imageUrl?: string; audioUrl?: string }>
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id, scenes, ts: Date.now() });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn("[scene-cache] write failed:", e);
  }
}

export async function getCachedStory(
  id: string
): Promise<Array<{ imageUrl: string; audioUrl: string }> | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        db.close();
        const row = req.result as { scenes: Array<{ imageUrl: string; audioUrl: string }> } | undefined;
        resolve(row?.scenes ?? null);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  } catch {
    return null;
  }
}

export async function evictOldStories(keepIds: string[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const keep = new Set(keepIds);
        for (const key of req.result as string[]) {
          if (!keep.has(key)) store.delete(key);
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  } catch (e) {
    console.warn("[scene-cache] evict failed:", e);
  }
}
