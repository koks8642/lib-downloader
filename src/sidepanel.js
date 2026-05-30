import { parseTab } from "./lib/sites.js";
import { fetchBook, fetchChapters, branchesFromChapters, chaptersForBranch, fetchChapter } from "./lib/api.js";
import { contentToParagraphs } from "./lib/parse.js";
import { BUILDERS, safeName } from "./lib/formats/index.js";
import { supportsFSAccess, pickDirectory, getSavedDirectory, saveBlob } from "./lib/fs.js";

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
  const can = state.selected.size > 0 && formats.length > 0 && state.ctx?.site?.kind === "novel";
  $("download-btn").disabled = !can;
  $("download-btn").textContent = state.selected.size
    ? `Скачать (${state.selected.size})` : "Скачать";
}
function selectedFormats() {
  return [...document.querySelectorAll('#format-section .formats input:checked')].map(i => i.value);
}

// ---------- рендер ----------
function renderBook() {
  const b = state.book, ctx = state.ctx;
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

  if (ctx.site.kind === "manga") {
    setStatus("Манга определена. Скачивание манги — в следующем обновлении.", "");
  }
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
  const chaptersData = [];

  try {
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
  } catch (e) {
    setStatus("Ошибка: " + e.message, "err");
  } finally {
    $("download-btn").disabled = false;
    setTimeout(() => { show($("progress-wrap"), false); bar.style.width = "0%"; }, 1500);
  }
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
document.querySelectorAll('#format-section .formats input').forEach(i =>
  i.addEventListener("change", updateCount));
$("pick-folder").addEventListener("click", async () => {
  try { await pickDirectory(); await refreshFolderLabel(); setStatus("Папка выбрана", "ok"); }
  catch { /* отмена */ }
});
$("download-btn").addEventListener("click", doDownload);
$("reload-tab").addEventListener("click", detectAndLoad);

// старт
refreshFolderLabel();
detectAndLoad();
