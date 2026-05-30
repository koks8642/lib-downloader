// Сохранение файлов через chrome.downloads — надёжно, без диалогов и крашей.
// Раскладываем по подпапкам внутри «Загрузок»: Lib Downloader/<название>/<файл>.
// Фолбэк (если нет chrome.downloads, напр. дев-страница) — <a download>.

const ROOT = "Lib Downloader";

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
      });
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return { method: "download", path: rel };
    } catch (e) {
      // упадём в фолбэк ниже
    }
  }

  // Фолбэк: <a download> (без подпапок — браузер заменит «/» на «_»).
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { method: "download", path: filename };
}

// Куда сохраняем (для отображения).
export function destinationLabel(title) {
  return `${ROOT} / ${sanitizeSegment(title)}`;
}
