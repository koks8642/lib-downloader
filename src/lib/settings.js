// Настройки расширения. Хранятся в chrome.storage.local,
// с фолбэком на localStorage (для дев-страницы itest).

export const DEFAULTS = {
  rpm: 240,            // лимит запросов в минуту (0 = без лимита)
  jpegQuality: 90,     // качество JPEG для PDF/автокадра, %
  autocrop: false,     // резать длинные страницы манхвы
  autocropRatio: 1.6,  // порог h/w, выше которого режем
};

const KEY = "libdl_settings";

function hasChromeStorage() {
  return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
}

export async function loadSettings() {
  try {
    if (hasChromeStorage()) {
      const got = await chrome.storage.local.get(KEY);
      return { ...DEFAULTS, ...(got[KEY] || {}) };
    }
    const raw = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveSettings(s) {
  const clean = { ...DEFAULTS, ...s };
  try {
    if (hasChromeStorage()) await chrome.storage.local.set({ [KEY]: clean });
    else localStorage.setItem(KEY, JSON.stringify(clean));
  } catch { /* ignore */ }
  return clean;
}
