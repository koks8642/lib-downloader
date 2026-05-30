import { parseTab } from "./lib/sites.js";
import { fetchBook, fetchChapters, branchesFromChapters, chaptersForBranch, fetchChapter,
         fetchImageServer, pageUrls } from "./lib/api.js";
import { contentToParagraphs } from "./lib/parse.js";
import { BUILDERS, safeName } from "./lib/formats/index.js";
import { buildCBZ, buildMangaPDF } from "./lib/formats/manga.js";
import { fetchImage, toJpegPage } from "./lib/img.js";
import { supportsFSAccess, pickDirectory, getSavedDirectory, saveBlob } from "./lib/fs.js";

const FORMATS = {
  novel: [
    { v: "epub", label: "EPUB", def: true },
    { v: "txt", label: "TXT" },
    { v: "fb2", label: "FB2" },
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
  view: [],         // главы текущей ветки [{number,numberFloat,volume,name}]
  selected: new Set(), // ключи выбранных глав (number)
};

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
  const cover = b?.cover?.default || b?.cover?.thumbnail || b?.background?.url;
  if (cover) { $("book-cover").src = cover; show($("book-cover"), true); }
  else show($("book-cover"), false);

  show($("branch-section"), true);
  show($("chapters-section"), true);
  show($("format-section"), true);
  show($("folder-section"), true);
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

function renderChapters() {
  state.view = chaptersForBranch(state.allChapters, state.bid);
  state.selected.clear();
  const ul = $("chapter-list");
  ul.innerHTML = "";
  for (const ch of state.view) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.dataset.num = ch.number;
    cb.addEventListener("change", () => {
      if (cb.checked) state.selected.add(ch.number); else state.selected.delete(ch.number);
      $("select-all").checked = state.selected.size === state.view.length;
      updateCount();
    });
    const num = document.createElement("span");
    num.className = "ch-num"; num.textContent = ch.number;
    const name = document.createElement("span");
    name.className = "ch-name"; name.textContent = ch.name || "";
    const lbl = document.createElement("label");
    lbl.className = "check"; lbl.style.flex = "1"; lbl.style.gap = "8px";
    lbl.append(cb, num, name);
    li.appendChild(lbl);
    ul.appendChild(li);
  }
  $("select-all").checked = false;
  $("range-from").value = ""; $("range-to").value = "";
  updateCount();
}

function applySelectionToCheckboxes() {
  for (const cb of document.querySelectorAll('#chapter-list input[type="checkbox"]')) {
    cb.checked = state.selected.has(cb.dataset.num);
  }
  $("select-all").checked = state.selected.size === state.view.length && state.view.length > 0;
  updateCount();
}

// ---------- загрузка данных ----------
async function detectAndLoad() {
  setStatus("Определяю вкладку…");
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const ctx = tab ? parseTab(tab.url || "") : null;
  if (!ctx || !ctx.slug) {
    show($("book-card"), false);
    show($("branch-section"), false); show($("chapters-section"), false);
    show($("format-section"), false); show($("folder-section"), false);
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
  const chaptersData = [];
  {
    for (let i = 0; i < nums.length; i++) {
      const ch = nums[i];
      setStatus(`Глава ${ch.number} (${i + 1}/${nums.length})…`);
      const data = await fetchChapter(state.ctx.slug, state.ctx.site.id,
        { number: ch.number, volume: ch.volume, bid: state.bid });
      const paras = contentToParagraphs(data.content);
      chaptersData.push({ number: ch.number, name: ch.name || data.name || "", paragraphs: paras });
      bar.style.width = `${Math.round(((i + 1) / nums.length) * 85)}%`;
    }

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
      if (fmt === "txt" && $("txt-per-chapter").checked) {
        for (const ch of chaptersData) {
          const single = { ...book, chapters: [ch] };
          const { blob } = BUILDERS.txt(single);
          const fn = `Глава_${String(parseFloat(ch.number)).padStart(3, "0")}.txt`;
          const r = await saveBlob(blob, fn, sub); saved.push(r);
        }
      } else {
        const { filename, blob } = BUILDERS[fmt](book);
        const r = await saveBlob(blob, filename, sub); saved.push(r);
      }
    }
    bar.style.width = "100%";
    const method = saved[0]?.method === "fs" ? `папку «${sub}»` : "Загрузки";
    setStatus(`Готово! Сохранено в ${method}. Файлов: ${saved.length}`, "ok");
  }
}

// Манга/манхва: по главам тянем картинки и пакуем в CBZ/PDF/исходники.
async function downloadManga(nums, formats, bar) {
  const { slug, site } = state.ctx;
  const titleStr = state.book?.rus_name || state.book?.name || slug;
  const sub = safeName(titleStr);
  const server = await fetchImageServer(site.id);

  let savedCount = 0, lastMethod = "fs";
  const totalChapters = nums.length;

  for (let i = 0; i < totalChapters; i++) {
    const ch = nums[i];
    const padNum = String(parseFloat(ch.number)).padStart(3, "0");
    setStatus(`Глава ${ch.number} (${i + 1}/${totalChapters}) — страницы…`);

    const data = await fetchChapter(slug, site.id,
      { number: ch.number, volume: ch.volume, bid: state.bid });
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
        const jpegPages = [];
        for (const img of images) jpegPages.push(await toJpegPage(img.bytes, img.type));
        const { filename, blob } = buildMangaPDF(jpegPages, base);
        const r = await saveBlob(blob, filename, sub); lastMethod = r.method; savedCount++;
      }
    }
  }

  bar.style.width = "100%";
  const where = lastMethod === "fs" ? `папку «${sub}»` : "Загрузки";
  setStatus(`Готово! Сохранено в ${where}. Глав: ${totalChapters}`, "ok");
}

// ---------- папка ----------
async function refreshFolderLabel() {
  if (!supportsFSAccess()) {
    $("folder-name").textContent = "Загрузки (этот браузер)";
    show($("fs-note"), true);
    $("pick-folder").disabled = true;
    return;
  }
  const dir = await getSavedDirectory();
  $("folder-name").textContent = dir ? dir.name : "не выбрана → Загрузки";
}

// ---------- события ----------
$("branch-select").addEventListener("change", (e) => {
  state.bid = e.target.value === "null" ? null : Number(e.target.value);
  renderChapters();
});
$("select-all").addEventListener("change", (e) => {
  state.selected = e.target.checked ? new Set(state.view.map(c => c.number)) : new Set();
  applySelectionToCheckboxes();
});
$("apply-range").addEventListener("click", () => {
  const from = parseFloat($("range-from").value);
  const to = parseFloat($("range-to").value);
  const lo = isNaN(from) ? -Infinity : from;
  const hi = isNaN(to) ? Infinity : to;
  state.selected = new Set(state.view.filter(c => c.numberFloat >= lo && c.numberFloat <= hi).map(c => c.number));
  applySelectionToCheckboxes();
});
$("pick-folder").addEventListener("click", async () => {
  try { await pickDirectory(); await refreshFolderLabel(); setStatus("Папка выбрана", "ok"); }
  catch { /* отмена */ }
});
$("download-btn").addEventListener("click", doDownload);
$("reload-tab").addEventListener("click", detectAndLoad);

// старт
refreshFolderLabel();
detectAndLoad();
