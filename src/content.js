// Встроенная боковая панель для браузеров без нативного chrome.sidePanel
// (Яндекс, Opera и др.). Инжектит на страницу Lib iframe с панелью, который
// живёт в том же табе — поэтому видит открытый тайтл напрямую (через chrome.tabs
// из расширенного контекста iframe). В Chrome/Edge не задействуется: там панель
// открывается нативно, сообщение toggle сюда не приходит, iframe не создаётся.

(() => {
  if (window.__libDownloaderInjected) return;
  window.__libDownloaderInjected = true;

  const PANEL_URL = chrome.runtime.getURL("src/sidepanel.html");
  const WIDTH = 392;
  let wrap = null, frame = null, isOpen = false;

  function build() {
    wrap = document.createElement("div");
    wrap.id = "lib-downloader-sidebar";
    Object.assign(wrap.style, {
      all: "initial", position: "fixed", top: "0", right: "0",
      height: "100vh", width: WIDTH + "px", maxWidth: "94vw",
      zIndex: "2147483647", transform: "translateX(100%)",
      transition: "transform .28s cubic-bezier(.22,.61,.36,1)",
      boxShadow: "-10px 0 40px rgba(0,0,0,.4)",
    });
    frame = document.createElement("iframe");
    Object.assign(frame.style, {
      display: "block", width: "100%", height: "100%", border: "0", margin: "0",
      padding: "0", background: "transparent", colorScheme: "normal",
    });
    frame.setAttribute("allowtransparency", "true");
    frame.src = PANEL_URL;
    wrap.appendChild(frame);
    (document.body || document.documentElement).appendChild(wrap);
  }

  function toggle(force) {
    if (!wrap) build();
    isOpen = (typeof force === "boolean") ? force : !isOpen;
    // на след. кадр — чтобы transition сработал при первом показе
    requestAnimationFrame(() => {
      wrap.style.transform = isOpen ? "translateX(0)" : "translateX(100%)";
    });
  }

  // Тоггл по клику на иконку (сообщение из background).
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "lib-toggle-panel") {
      toggle();
      sendResponse && sendResponse({ ok: true });
    }
    return false;
  });

  // Панель может попросить закрыться (Esc / кнопка внутри iframe).
  window.addEventListener("message", (e) => {
    if (e && e.data === "lib-close-panel") toggle(false);
  });
})();
