// Клиент API группы Lib (общий backend api.cdnlibs.org).
import { API_HOST } from "./sites.js";

function headers(siteId) {
  return {
    "Accept": "application/json",
    "Site-Id": String(siteId),
  };
}

// Ошибка заблокированной (платной/раннего доступа) главы.
export class LockedError extends Error {
  constructor(msg) { super(msg || "Глава недоступна (ранний доступ)"); this.name = "LockedError"; this.locked = true; }
}

// --- Ограничитель частоты запросов: не более N запросов в минуту,
//     с минимальным интервалом, и ретраями на 429. ---
const limiter = {
  minIntervalMs: 0,      // вычисляется из rpm
  _last: 0,
  setRpm(rpm) { this.minIntervalMs = rpm > 0 ? Math.ceil(60000 / rpm) : 0; },
  async wait() {
    if (!this.minIntervalMs) return;
    const now = Date.now();
    const gap = this._last + this.minIntervalMs - now;
    if (gap > 0) await new Promise(r => setTimeout(r, gap));
    this._last = Date.now();
  },
};
export function setRateLimit(rpm) { limiter.setRpm(rpm); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJSON(url, siteId, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    await limiter.wait();
    let r;
    try {
      r = await fetch(url, { headers: headers(siteId) });
    } catch (e) {
      if (attempt < retries) { await sleep(800 * (attempt + 1)); continue; }
      throw e;
    }
    if (r.status === 429) {
      // сервер просит подождать
      const ra = Number(r.headers.get("retry-after")) || (2 * (attempt + 1));
      if (attempt < retries) { await sleep(ra * 1000); continue; }
      throw new Error("429: слишком много запросов");
    }
    if (!r.ok) {
      if (r.status >= 500 && attempt < retries) { await sleep(800 * (attempt + 1)); continue; }
      throw new Error(`HTTP ${r.status}`);
    }
    // Заблокированные главы отдают HTML вместо JSON.
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("json")) {
      const text = await r.text();
      if (text.trimStart().startsWith("<")) throw new LockedError();
      try { return JSON.parse(text); } catch { throw new LockedError(); }
    }
    return r.json();
  }
}

// Инфо о книге (название, обложка). Пробуем дотянуть автора/описание через
// fields[], но не падаем, если бэкенд их не принимает (422) — берём базовый ответ.
export async function fetchBook(slug, siteId) {
  try {
    const fields = ["summary", "authors"].map(f => `fields[]=${f}`).join("&");
    const data = await getJSON(`${API_HOST}/manga/${slug}?${fields}`, siteId);
    return data.data || data;
  } catch {
    const data = await getJSON(`${API_HOST}/manga/${slug}`, siteId);
    return data.data || data;
  }
}

// Полный список глав со всеми ветками переводчиков.
export async function fetchChapters(slug, siteId) {
  const data = await getJSON(`${API_HOST}/manga/${slug}/chapters`, siteId);
  return data.data || [];
}

// Сводка по веткам (переводчикам): bid -> {name, count}.
export function branchesFromChapters(chapters) {
  const map = new Map();
  for (const ch of chapters) {
    for (const br of ch.branches || []) {
      const bid = br.branch_id;
      if (bid == null) continue;
      const teams = br.teams || [];
      const name = teams.length ? teams.map(t => t.name).join(", ") : "Без команды";
      const cur = map.get(bid) || { bid, name, count: 0 };
      cur.count += 1;
      if (cur.name === "Без команды" && name !== "Без команды") cur.name = name;
      map.set(bid, cur);
    }
  }
  // Спец-вариант: ветка по умолчанию (одиночные главы без branch_id)
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// Определить, заблокирована ли ветка (платный ранний доступ).
function branchLock(br) {
  const rv = br && br.restricted_view;
  if (rv && rv.is_open === false) {
    return { locked: true, until: rv.expired_at || null };
  }
  return { locked: false, until: null };
}

// Главы, относящиеся к выбранной ветке (bid). Если bid == null — берём все.
// Каждая глава получает флаг locked (нельзя скачать — ранний доступ/платно).
export function chaptersForBranch(chapters, bid) {
  return chapters
    .map(ch => {
      const br = (ch.branches || []).find(b => bid == null || b.branch_id === bid);
      if (bid != null && !br) return null;
      const lock = branchLock(br || (ch.branches || [])[0]);
      return {
        number: ch.number,
        numberFloat: parseFloat(ch.number),
        volume: ch.volume ?? "1",
        name: ch.name || "",
        id: ch.id,
        locked: lock.locked,
        lockedUntil: lock.until,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.numberFloat - b.numberFloat) || 0);
}

// Контент одной главы. Для новелл вернёт {content}, для манги {pages}.
export async function fetchChapter(slug, siteId, { number, volume, bid }) {
  const q = new URLSearchParams({ number: String(number), volume: String(volume) });
  if (bid != null) q.set("branch_id", String(bid));
  const data = await getJSON(`${API_HOST}/manga/${slug}/chapter?${q}`, siteId);
  return data.data || data;
}

// Базовый URL сервера картинок ("main") для нужного сайта.
let _imgServerCache = new Map();
export async function fetchImageServer(siteId) {
  if (_imgServerCache.has(siteId)) return _imgServerCache.get(siteId);
  const data = await getJSON(`${API_HOST}/constants?fields[]=imageServers`, siteId);
  const servers = (data.data || data).imageServers || [];
  const pick = servers.find(s => s.id === "main" && (s.site_ids || []).includes(Number(siteId)) && s.url)
            || servers.find(s => (s.site_ids || []).includes(Number(siteId)) && s.url);
  const url = pick ? pick.url.replace(/\/$/, "") : "https://img2.imglib.info";
  _imgServerCache.set(siteId, url);
  return url;
}

// Абсолютные URL страниц главы манги.
export function pageUrls(chapter, imageServer) {
  const pages = chapter.pages || [];
  return pages.map(p => {
    const path = p.url || (p.image ? `/${p.image}` : "");
    if (/^https?:/.test(path)) return path;
    return imageServer.replace(/\/$/, "") + path;
  }).filter(Boolean);
}
