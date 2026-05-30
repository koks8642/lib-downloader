// Service worker.

// Открывать боковую панель по клику на иконку.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  setupReferer();
});
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(setupReferer);

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open && tab && tab.windowId != null) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// Серверы картинок Lib отдают изображения только с «своим» реферером
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
