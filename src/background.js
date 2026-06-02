// Service worker. Кросс-браузерное открытие панели.
//
// Chrome / Edge: нативная боковая панель (chrome.sidePanel).
// Яндекс / Opera / Brave и любой Chromium без флага YandexSidePanel:
//   встроенная боковая панель прямо на странице Lib (iframe из content.js).
//   Если вкладка не из группы Lib (нет content-скрипта) — окно-попап.

const PANEL_PATH = "src/sidepanel.html";
const CONTENT_JS = "src/content.js";
const POPUP = { width: 430, height: 760 };

function hasSidePanel() {
  return !!(chrome.sidePanel && typeof chrome.sidePanel.open === "function");
}

chrome.runtime.onInstalled.addListener(setupReferer);
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(setupReferer);

// Открытие по клику на иконку. Намеренно НЕ используем setPanelBehavior
// (openPanelOnActionClick), чтобы onClicked всегда срабатывал и мы сами решали,
// куда открывать.
chrome.action.onClicked.addListener(async (tab) => {
  // 1) Chrome / Edge — нативная боковая панель.
  if (hasSidePanel() && tab && tab.windowId != null) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    } catch (e) { /* флаг выключен — идём дальше */ }
  }
  // 2) Яндекс/Opera и др. — встроенная панель на странице Lib (content.js).
  if (tab && tab.id != null) {
    if (await toggleInPagePanel(tab.id)) return;
  }
  // 3) Не страница Lib — крайний фолбэк: окно-попап.
  await openPopup();
});

// Показать/спрятать встроенную панель. Если content-скрипт ещё не загружен
// (или страница открыта до установки) — инжектим его и повторяем.
async function toggleInPagePanel(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "lib-toggle-panel" });
    return true;
  } catch (e) {
    if (!chrome.scripting || !chrome.scripting.executeScript) return false;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_JS] });
      await chrome.tabs.sendMessage(tabId, { type: "lib-toggle-panel" });
      return true;
    } catch (e2) {
      return false; // не страница Lib (нет host-доступа) — уйдём в попап
    }
  }
}

// Открыть панель окном-попапом. Если уже открыто — просто сфокусировать.
async function openPopup() {
  const url = chrome.runtime.getURL(PANEL_PATH);
  try {
    const wins = await chrome.windows.getAll({ populate: true });
    for (const w of wins) {
      if ((w.tabs || []).some(t => t.url === url)) {
        await chrome.windows.update(w.id, { focused: true });
        return;
      }
    }
  } catch (e) { /* getAll может быть недоступен — просто создадим окно */ }
  chrome.windows.create({ url, type: "popup", width: POPUP.width, height: POPUP.height });
}

// Серверы картинок Lib отдают изображения только со «своим» реферером
// (хотлинк-защита). Подставляем Referer для запросов к ним — иначе 403.
function setupReferer() {
  if (!chrome.declarativeNetRequest || !chrome.declarativeNetRequest.updateSessionRules) return;
  chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          { header: "Referer", operation: "set", value: "https://mangalib.me/" },
        ],
      },
      condition: {
        requestDomains: ["imglib.info", "mixlib.me", "hentaicdn.org"],
        resourceTypes: ["xmlhttprequest", "image", "media", "other"],
      },
    }],
  }).catch(() => {});
}
