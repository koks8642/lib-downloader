// Работа с целевой папкой через File System Access API.
// Хэндл папки сохраняем в IndexedDB, чтобы не выбирать каждый раз.
// На Firefox (нет showDirectoryPicker) — фолбэк на скачивание через <a download>.

const DB = "lib-downloader", STORE = "handles", KEY = "dir";

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
  });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, "readwrite").objectStore(STORE).put(val, key);
    t.onsuccess = () => res(); t.onerror = () => rej(t.error);
  });
}

export function supportsFSAccess() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickDirectory() {
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  await idbSet(KEY, handle);
  return handle;
}

export async function getSavedDirectory() {
  try { return (await idbGet(KEY)) || null; } catch { return null; }
}

// Сбросить выбранную папку (вернуться к «Загрузкам») без открытия диалога.
export async function clearDirectory() {
  try { await idbSet(KEY, null); } catch { /* ignore */ }
}

async function ensurePermission(handle) {
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

// Записать blob. Если есть папка-хэндл и доступ — пишем туда (в подпапку book).
// Иначе — обычное скачивание в Downloads.
export async function saveBlob(blob, filename, subfolder) {
  const dir = await getSavedDirectory();
  if (dir && supportsFSAccess() && (await ensurePermission(dir))) {
    let target = dir;
    if (subfolder) {
      for (const part of String(subfolder).split("/").filter(Boolean)) {
        target = await target.getDirectoryHandle(part, { create: true });
      }
    }
    const fh = await target.getFileHandle(filename, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return { method: "fs", path: (subfolder ? subfolder + "/" : "") + filename };
  }
  // Фолбэк: скачивание в «Загрузки» (слэш в имени браузер заменяет на _,
  // поэтому подпапку не приклеиваем — отдаём чистое имя файла).
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { method: "download", path: filename };
}
