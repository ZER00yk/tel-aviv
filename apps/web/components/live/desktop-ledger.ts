let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!opening)
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("tell-aviv-desktop", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("seen", {
          keyPath: "key",
        });
        store.createIndex("user", "userId");
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        opening = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        opening = undefined;
        reject(new Error("Desktop notification storage is blocked"));
      };
    });
  return opening;
}
/** IndexedDB read/write transactions serialize across renderer processes. */
export async function claimDesktopNotice(
  userId: string,
  id: string,
  now: number,
) {
  const db = await database();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction("seen", "readwrite"),
      store = tx.objectStore("seen");
    let claimed = false;
    const request = store.index("user").getAll(userId);
    request.onsuccess = () => {
      const rows = request.result as {
        key: string;
        userId: string;
        id: string;
        at: number;
      }[];
      const recent = rows
        .filter(
          (row) =>
            Number.isFinite(row.at) &&
            row.at <= now &&
            now - row.at < 24 * 60 * 60_000,
        )
        .sort((a, b) => a.at - b.at);
      if (recent.some((row) => row.id === id)) return;
      claimed = true;
      const keep = new Set(recent.slice(-127).map((row) => row.key));
      for (const row of rows) if (!keep.has(row.key)) store.delete(row.key);
      store.put({ key: `${userId}:${id}`, userId, id, at: now });
    };
    tx.oncomplete = () => resolve(claimed);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(
        tx.error ?? new Error("Desktop notification claim was interrupted"),
      );
  });
}
