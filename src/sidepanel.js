import { parseTab } from "./lib/sites.js";
import { fetchBook, fetchChapters, branchesFromChapters, chaptersForBranch, fetchChapter,
         fetchImageServer, pageUrls, setRateLimit, LockedError } from "./lib/api.js";
import { contentToParagraphs } from "./lib/parse.js";
import { BUILDERS, safeName } from "./lib/formats/index.js";
import { buildCBZ, buildMangaPDF } from "./lib/formats/manga.js";
import { fetchImage, toJpegPage, splitToJpegPages } from "./lib/img.js";
import { saveBlob, destinationLabel } from "./lib/fs.js";
import { loadSettings, saveSettings, DEFAULTS } from "./lib/settings.js";

const FORMATS = {
  novel: [
    { v: "epub", label: "EPUB", def: true },
    { v: "fb2", label: "FB2" },
    { v: "txt", label: "TXT" },
    { v: "md", label: "MD" },
    { v: "json", label: "JSON" },
  ],
  manga: [
    { v: "cbz", label: "CBZ", def: true },
    { v: "pdf", label: "PDF" },
    { v: "images", label: "Картинки" },
  ],
};

// Затемнить hex-цвет на коэффициент k (0..1).
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - k));
  const g = Math.round(((n >> 8) & 255) * (1 - k));
  const b = Math.round((n & 255) * (1 - k));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
function applyTheme(color) {
  if (!color) return;
  const root = document.documentElement.style;
  root.setProperty("--accent", color);
  root.setProperty("--accent-press", shade(color, 0.15));
  root.setProperty("--accent-soft", color + "22"); // ~13% alpha
}

const $ = (id) => document.getElementById(id);
const state = {
  ctx: null,        // {host, site, slug, bid}
  book: null,
  allChapters: [],  // полный список глав API
  branches: [],     // [{bid,name,count}]
  bid: null,
  view: [],         // главы текущей ветки [{number,numberFloat,volume,name,locked}]
  selected: new Set(), // ключи выбранных глав (number)
  settings: { ...DEFAULTS },
};

// доступные (не заблокированные) главы текущей ветки
function freeChapters() { return state.view.filter(c => !c.locked); }

// ---------- утилиты UI ----------
function show(el, on = true) { el.classList.toggle("hidden", !on); }
function setStatus(msg, kind = "") {
  const s = $("status-line"); s.textContent = msg;
  s.className = "status-line " + (kind || "muted");
}
function updateCount() {
  $("selected-count").textContent = `${state.selected.size} выбрано`;
  const formats = selectedFormats();
  const can = state.selected.size > 0 && formats.length > 0;
  $("download-btn").disabled = !can;
  $("download-btn").textContent = state.selected.size
    ? `Скачать (${state.selected.size})` : "Скачать";
}
function selectedFormats() {
  return [...document.querySelectorAll('#formats input:checked')].map(i => i.value);
}
function renderFormats(kind) {
  const wrap = $("formats");
  wrap.innerHTML = "";
  for (const f of FORMATS[kind] || FORMATS.novel) {
    const lbl = document.createElement("label");
    lbl.className = "check chip";
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = f.v; cb.checked = !!f.def;
    cb.addEventListener("change", updateCount);
    const sp = document.createElement("span"); sp.textContent = f.label;
    lbl.append(cb, sp);
    wrap.appendChild(lbl);
  }
  show($("per-chapter-wrap"), kind === "novel");
}

// ---------- рендер ----------
function renderBook() {
  const b = state.book, ctx = state.ctx;
  applyTheme(ctx.site.color);
  renderFormats(ctx.site.kind);
  show($("empty-hint"), false);
  show($("book-card"), true);
  $("book-title").textContent = b?.rus_name || b?.name || ctx.slug;
  const sub = [];
  if (b?.eng_name) sub.push(b.eng_name);
  $("book-sub").textContent = sub.join(" · ");
  $("site-badge").textContent = ctx.site.name + (ctx.site.kind === "manga" ? " · манга" : "");
  const cover = b?.cover?.default || b?.cover?.thumbnail || b?.cover?.md || b?.background?.url;
  loadCover(cover);

  show($("branch-section"), true);
  show($("chapters-section"), true);
  show($("format-section"), true);
  show($("settings-section"), true);
  show($("footer"), true);
}

function renderBranches() {
  const sel = $("branch-select");
  sel.innerHTML = "";
  for (const br of state.branches) {
    const o = document.createElement("option");
    o.value = String(br.bid);
    o.textContent = `${br.name} (${br.count})`;
    sel.appendChild(o);
  }
  // выбрать ветку из URL, либо самую полную
  const initial = state.ctx.bid && state.branches.some(b => b.bid === state.ctx.bid)
    ? state.ctx.bid : (state.branches[0]?.bid ?? null);
  sel.value = String(initial);
  state.bid = initial;
}

// Грузим обложку через fetch→blob (host_permissions снимают CORS/referer-защиту),
// с фолбэком на прямой src. Прячем, если не вышло.
async function loadCover(url) {
  const img = $("book-cover");
  if (!url) { show(img, false); return; }
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error();
    const blob = await r.blob();
    if (img._url) URL.revokeObjectURL(img._url);
    img._url = URL.createObjectURL(blob);
    img.src = img._url; show(img, true);
  } catch {
    img.onerror = () => show(img, false);
    img.onload = () => show(img, true);
    img.src = url; show(img, true);
  }
}

function lockTitle(ch) {
  if (!ch.lockedUntil) return "Платно / ранний доступ — недоступно для скачивания";
  const d = new Date(ch.lockedUntil);
  const date = isNaN(d) ? "" : d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  return date ? `Ранний доступ — откроется ${date}` : "Ранний доступ — недоступно";
}

function renderChapters() {
  state.view = chaptersForBranch(state.allChapters, state.bid);
  state.selected.clear();
  const ul = $("chapter-list");
  ul.innerHTML = "";
  const frag = document.createDocumentFragment();
  const lockedCount = state.view.filter(c => c.locked).length;
  for (const ch of state.view) {
    const li = document.createElement("li");
    if (ch.locked) li.classList.add("locked");

    const num = document.createElement("span");
    num.className = "ch-num"; num.textContent = ch.number;
    const name = document.createElement("span");
    name.className = "ch-name"; name.textContent = ch.name || "";

    const lbl = document.createElement("label");
    lbl.className = "check"; lbl.style.flex = "1"; lbl.style.gap = "8px";

    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.dataset.num = ch.number;
    if (ch.locked) {
      cb.disabled = true;
      lbl.append(cb, num, name);
      const lock = document.createElement("span");
      lock.className = "ch-lock"; lock.textContent = "🔒";
      lock.title = lockTitle(ch);
      li.title = lockTitle(ch);
      li.append(lbl, lock);
    } else {
      cb.addEventListener("change", () => {
        if (cb.checked) state.selected.add(ch.number); else state.selected.delete(ch.number);
        syncSelectAll();
        updateCount();
      });
      lbl.append(cb, num, name);
      li.appendChild(lbl);
    }
    frag.appendChild(li);
  }
  ul.appendChild(frag);
  $("select-all").checked = false;
  $("range-from").value = ""; $("range-to").value = "";
  // подпись о платных главах
  const note = $("locked-note");
  if (lockedCount > 0) { note.textContent = `🔒 ${lockedCount} глав(ы) недоступно (ранний доступ)`; show(note, true); }
  else show(note, false);
  updateCount();
}

function syncSelectAll() {
  const free = freeChapters().length;
  $("select-all").checked = free > 0 && state.selected.size === free;
}

function applySelectionToCheckboxes() {
  for (const cb of document.querySelectorAll('#chapter-list input[type="checkbox"]')) {
    if (cb.disabled) continue;
    cb.checked = state.selected.has(cb.dataset.num);
  }
  syncSelectAll();
  updateCount();
}

// ---------- загрузка данных ----------
async function detectAndLoad() {
  setStatus("Определяю вкладку…");
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); }
  catch { tab = null; }
  const ctx = tab ? parseTab(tab.url || "") : null;
  lastKey = ctxKey(ctx);
  if (!ctx || !ctx.slug) {
    state.ctx = null;
    show($("book-card"), false);
    show($("branch-section"), false); show($("chapters-section"), false);
    show($("format-section"), false); show($("settings-section"), false);
    show($("footer"), false);
    show($("empty-hint"), true);
    setStatus("");
    return;
  }
  state.ctx = ctx;
  try {
    setStatus("Загружаю информацию о тайтле…");
    const [book, chapters] = await Promise.all([
      fetchBook(ctx.slug, ctx.site.id).catch(() => null),
      fetchChapters(ctx.slug, ctx.site.id),
    ]);
    state.book = book;
    state.allChapters = chapters;
    state.branches = branchesFromChapters(chapters);
    if (state.branches.length === 0) state.branches = [{ bid: null, name: "Все главы", count: chapters.length }];
    renderBook();
    renderBranches();
    renderChapters();
    setStatus(`Найдено глав: ${state.allChapters.length}`, "ok");
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  }
}

// ---------- скачивание ----------
async function doDownload() {
  const formats = selectedFormats();
  const nums = state.view.filter(c => state.selected.has(c.number));
  if (!nums.length || !formats.length) return;

  $("download-btn").disabled = true;
  show($("progress-wrap"), true);
  const bar = $("progress-bar");
  try {
    if (state.ctx.site.kind === "manga") {
      await downloadManga(nums, formats, bar);
    } else {
      await downloadNovel(nums, formats, bar);
    }
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  } finally {
    $("download-btn").disabled = false;
    setTimeout(() => { show($("progress-wrap"), false); bar.style.width = "0%"; }, 1500);
  }
}

async function downloadNovel(nums, formats, bar) {
  nums = nums.filter(c => !c.locked);
  const chaptersData = [];
  let skipped = 0;
  {
    for (let i = 0; i < nums.length; i++) {
      const ch = nums[i];
      setStatus(`Глава ${ch.number} (${i + 1}/${nums.length})…`);
      let data;
      try {
        data = await fetchChapter(state.ctx.slug, state.ctx.site.id,
          { number: ch.number, volume: ch.volume, bid: state.bid });
      } catch (e) {
        if (e instanceof LockedError) { skipped++; continue; }
        throw e;
      }
      const paras = contentToParagraphs(data.content);
      chaptersData.push({ number: ch.number, name: ch.name || data.name || "", paragraphs: paras });
      bar.style.width = `${Math.round(((i + 1) / nums.length) * 85)}%`;
    }
    if (!chaptersData.length) { setStatus("Нечего сохранять (все выбранные главы недоступны)", "err"); return; }

    const titleStr = state.book?.rus_name || state.book?.name || state.ctx.slug;
    const book = {
      title: titleStr,
      author: (state.book?.authors?.[0]?.name) || state.branches.find(b => b.bid === state.bid)?.name || "",
      slug: state.ctx.slug, siteName: state.ctx.site.name, lang: "ru",
      chapters: chaptersData,
    };
    const sub = safeName(titleStr);

    setStatus("Формирую файлы…");
    let saved = [];
    for (const fmt of formats) {
      if ((fmt === "txt" || fmt === "md") && $("txt-per-chapter").checked) {
        for (const ch of chaptersData) {
          const single = { ...book, chapters: [ch] };
          const { blob } = BUILDERS[fmt](single);
          const fn = `Глава_${String(parseFloat(ch.number)).padStart(3, "0")}.${fmt}`;
          const r = await saveBlob(blob, fn, sub); saved.push(r);
        }
      } else {
        const { filename, blob } = BUILDERS[fmt](book);
        const r = await saveBlob(blob, filename, sub); saved.push(r);
      }
    }
    bar.style.width = "100%";
    const skip = skipped ? ` · пропущено платных: ${skipped}` : "";
    setStatus(`Готово · файлов: ${saved.length}${skip} · в «${destinationLabel(titleStr)}»`, "ok");
  }
}

// Манга/манхва: по главам тянем картинки и пакуем в CBZ/PDF/исходники.
async function downloadManga(nums, formats, bar) {
  nums = nums.filter(c => !c.locked);
  const { slug, site } = state.ctx;
  const titleStr = state.book?.rus_name || state.book?.name || slug;
  const sub = safeName(titleStr);
  const server = await fetchImageServer(site.id);

  let savedCount = 0, lastMethod = "fs", skipped = 0;
  const totalChapters = nums.length;

  for (let i = 0; i < totalChapters; i++) {
    const ch = nums[i];
    const padNum = String(parseFloat(ch.number)).padStart(3, "0");
    setStatus(`Глава ${ch.number} (${i + 1}/${totalChapters}) — страницы…`);

    let data;
    try {
      data = await fetchChapter(slug, site.id,
        { number: ch.number, volume: ch.volume, bid: state.bid });
    } catch (e) {
      if (e instanceof LockedError) { skipped++; continue; }
      throw e;
    }
    const urls = pageUrls(data, server);

    // качаем все страницы главы
    const images = [];
    for (let p = 0; p < urls.length; p++) {
      images.push(await fetchImage(urls[p]));
      const chFrac = (i + (p + 1) / Math.max(urls.length, 1)) / totalChapters;
      bar.style.width = `${Math.round(chFrac * 90)}%`;
    }

    const base = `Глава_${padNum}`;
    for (const fmt of formats) {
      if (fmt === "cbz") {
        const { filename, blob } = buildCBZ(images, base);
        const r = await saveBlob(blob, filename, sub); lastMethod = r.method; savedCount++;
      } else if (fmt === "images") {
        for (let p = 0; p < images.length; p++) {
          const img = images[p];
          const fn = `${String(p + 1).padStart(3, "0")}.${img.ext}`;
          const r = await saveBlob(new Blob([img.bytes]), fn, `${sub}/${base}`);
          lastMethod = r.method;
        }
        savedCount++;
      } else if (fmt === "pdf") {
        const q = (state.settings.jpegQuality || 90) / 100;
        const jpegPages = [];
        for (const img of images) {
          if (state.settings.autocrop) {
            const parts = await splitToJpegPages(img.bytes, img.type,
              { enabled: true, ratio: state.settings.autocropRatio, quality: q });
            jpegPages.push(...parts);
          } else {
            jpegPages.push(await toJpegPage(img.bytes, img.type, q));
          }
        }
        const { filename, blob } = buildMangaPDF(jpegPages, base);
        const r = await saveBlob(blob, filename, sub); lastMethod = r.method; savedCount++;
      }
    }
  }

  bar.style.width = "100%";
  const skip = skipped ? ` · пропущено платных: ${skipped}` : "";
  setStatus(`Готово · глав: ${totalChapters - skipped}${skip} · в «${destinationLabel(titleStr)}»`, "ok");
}

// ---------- события ----------
$("branch-select").addEventListener("change", (e) => {
  state.bid = e.target.value === "null" ? null : Number(e.target.value);
  renderChapters();
});
$("select-all").addEventListener("change", (e) => {
  state.selected = e.target.checked ? new Set(freeChapters().map(c => c.number)) : new Set();
  applySelectionToCheckboxes();
});
$("apply-range").addEventListener("click", () => {
  const from = parseFloat($("range-from").value);
  const to = parseFloat($("range-to").value);
  const lo = isNaN(from) ? -Infinity : from;
  const hi = isNaN(to) ? Infinity : to;
  state.selected = new Set(freeChapters()
    .filter(c => c.numberFloat >= lo && c.numberFloat <= hi).map(c => c.number));
  applySelectionToCheckboxes();
});
$("download-btn").addEventListener("click", doDownload);

// ---------- настройки ----------
function bindSettingsUI() {
  const s = state.settings;
  $("set-rpm").value = s.rpm;
  $("set-quality").value = s.jpegQuality;
  $("set-quality-val").textContent = s.jpegQuality + "%";
  $("set-autocrop").checked = s.autocrop;

  const persist = async () => {
    state.settings = await saveSettings(state.settings);
    setRateLimit(state.settings.rpm);
  };
  $("set-rpm").addEventListener("change", async () => {
    const v = Math.max(0, parseInt($("set-rpm").value) || 0);
    state.settings.rpm = v; $("set-rpm").value = v; await persist();
  });
  $("set-quality").addEventListener("input", () => {
    $("set-quality-val").textContent = $("set-quality").value + "%";
  });
  $("set-quality").addEventListener("change", async () => {
    state.settings.jpegQuality = parseInt($("set-quality").value); await persist();
  });
  $("set-autocrop").addEventListener("change", async () => {
    state.settings.autocrop = $("set-autocrop").checked; await persist();
  });
  $("settings-toggle").addEventListener("click", () => {
    const body = $("settings-body");
    show(body, body.classList.contains("hidden"));
    $("settings-toggle").classList.toggle("open");
  });
}

// ---------- авто-обновление при переходах между тайтлами ----------
let lastKey = "__init__";
function ctxKey(ctx) {
  return ctx && ctx.slug ? `${ctx.site.id}:${ctx.slug}` : "none";
}
async function maybeReload() {
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); }
  catch { return; }
  const ctx = tab ? parseTab(tab.url || "") : null;
  const key = ctxKey(ctx);
  if (key === lastKey) return;     // тайтл/сайт не изменился — не дёргаем
  lastKey = key;
  await detectAndLoad();
}
function bindAutoRefresh() {
  if (typeof chrome === "undefined" || !chrome.tabs) return;
  let t = null;
  const debounced = () => { clearTimeout(t); t = setTimeout(maybeReload, 250); };
  chrome.tabs.onActivated.addListener(debounced);
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url || info.status === "complete") debounced();
  });
}

// старт
(async () => {
  state.settings = await loadSettings();
  setRateLimit(state.settings.rpm);
  bindSettingsUI();
  bindAutoRefresh();
  lastKey = "__init__";
  await detectAndLoad();
})();
