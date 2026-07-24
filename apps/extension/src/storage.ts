// Thin, promise-based wrapper over chrome.storage.local with a localStorage
// fallback so the popup also works when opened as a plain web page during dev.
// chrome.storage.local persists across browser restarts.

const hasChromeStorage =
  typeof chrome !== "undefined" && !!chrome.storage?.local;

export function storageGet<T>(key: string, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    if (hasChromeStorage) {
      chrome.storage.local.get({ [key]: fallback }, (res) => {
        resolve(res[key] as T);
      });
    } else {
      const raw = localStorage.getItem(key);
      if (raw === null) return resolve(fallback);
      try {
        resolve(JSON.parse(raw) as T);
      } catch {
        resolve(fallback);
      }
    }
  });
}

export function storageSet<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve) => {
    if (hasChromeStorage) {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    } else {
      localStorage.setItem(key, JSON.stringify(value));
      resolve();
    }
  });
}
