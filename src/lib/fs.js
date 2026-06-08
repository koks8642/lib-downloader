// Сохранение файлов через chrome.downloads — надёжно, без диалогов и крашей.
// Раскладываем по подпапкам внутри «Загрузок»: Lib Downloader/<название>/<файл>.
// Фолбэк (если нет chrome.downloads, напр. дев-страница) — <a download>.

const ROOT = "Lib Downloader";
const FALLBACK_REVOKE_MS = 60 * 60 * 1000;

function sanitizeSegment(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, "_").replace(/\.+$/g, "").trim().slice(0, 120) || "файл";
}

// subfolder может содержать "/" (напр. "Название/Глава_001").
function buildPath(filename, subfolder) {
  const parts = [ROOT];
  if (subfolder) {
    for (const seg of String(subfolder).split("/").filter(Boolean)) parts.push(sanitizeSegment(seg));
  }
  parts.push(sanitizeSegment(filename));
  return parts.join("/");
}

function hasDownloads() {
  return typeof chrome !== "undefined" && chrome.downloads && chrome.downloads.download;
}

function safeRevoke(url) {
  try { URL.revokeObjectURL(url); } catch { /* ignore */ }
}

function revokeWhenDownloadEnds(id, url) {
  if (!chrome.downloads.onChanged) {
    setTimeout(() => safeRevoke(url), FALLBACK_REVOKE_MS);
    return;
  }

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    chrome.downloads.onChanged.removeListener(onChanged);
    safeRevoke(url);
  };
  const onChanged = (delta) => {
    if (delta.id !== id) return;
    if (delta.state?.current === "complete" || delta.error?.current) cleanup();
  };

  chrome.downloads.onChanged.addListener(onChanged);
  if (chrome.downloads.search) {
    chrome.downloads.search({ id }).then((items) => {
      const item = items && items[0];
      if (item && (item.state === "complete" || item.error)) cleanup();
    }).catch(() => {});
  }
}

export async function saveBlob(blob, filename, subfolder) {
  const rel = buildPath(filename, subfolder);
  const url = URL.createObjectURL(blob);

  if (hasDownloads()) {
    try {
      await new Promise((res, rej) => {
        chrome.downloads.download(
          { url, filename: rel, conflictAction: "uniquify", saveAs: false },
          (id) => {
            const err = chrome.runtime && chrome.runtime.lastError;
            if (err) rej(new Error(err.message)); else res(id);
          }
        );
      }).then((id) => revokeWhenDownloadEnds(id, url));
      return { method: "download", path: rel };
    } catch (e) {
      // упадём в фолбэк ниже
    }
  }

  // Фолбэк: <a download> (без подпапок — браузер заменит «/» на «_»).
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => safeRevoke(url), FALLBACK_REVOKE_MS);
  return { method: "download", path: filename };
}

// Куда сохраняем (для отображения).
export function destinationLabel(title) {
  return `${ROOT} / ${sanitizeSegment(title)}`;
}
