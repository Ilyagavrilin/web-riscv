function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("scr1-workspace", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("assets", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function assets(action, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
          "assets",
          action === "list" ? "readonly" : "readwrite",
        ),
        store = tx.objectStore("assets");
      const request =
        action === "list"
          ? store.getAll()
          : action === "delete"
            ? store.delete(value)
            : store.put(value);
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
