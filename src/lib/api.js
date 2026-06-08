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

function retryAfterSeconds(r, attempt) {
  const ra = r.headers.get("retry-after");
  const secs = Number(ra);
  if (Number.isFinite(secs) && secs > 0) return secs;
  const when = Date.parse(ra);
  if (!Number.isNaN(when)) return Math.max(1, Math.ceil((when - Date.now()) / 1000));
  return 2 * (attempt + 1);
}

export async function rateLimitedFetch(url, init = {}, { retries = 3, retryServerErrors = true } = {}) {
  for (let attempt = 0; ; attempt++) {
    await limiter.wait();
    try {
      const r = await fetch(url, init);
      if (r.status === 429) {
        if (attempt < retries) { await sleep(retryAfterSeconds(r, attempt) * 1000); continue; }
        throw new Error("429: слишком много запросов");
      }
      if (!r.ok) {
        if (retryServerErrors && r.status >= 500 && attempt < retries) {
          await sleep(800 * (attempt + 1));
          continue;
        }
      }
      return r;
    } catch (e) {
      if (attempt < retries) { await sleep(800 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

async function getJSON(url, siteId, { retries = 3 } = {}) {
  const r = await rateLimitedFetch(url, { headers: headers(siteId) }, { retries });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  // Заблокированные главы отдают HTML вместо JSON.
  const ct = r.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    const text = await r.text();
    if (text.trimStart().startsWith("<")) throw new LockedError();
    try { return JSON.parse(text); } catch { throw new LockedError(); }
  }
  return r.json();
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
  let looseCount = 0;
  for (const ch of chapters) {
    const branches = ch.branches || [];
    if (!branches.length) {
      looseCount += 1;
      continue;
    }
    let sawRealBranch = false;
    for (const br of branches) {
      const bid = br.branch_id;
      if (bid == null) continue;
      sawRealBranch = true;
      const teams = br.teams || [];
      const name = teams.length ? teams.map(t => t.name).join(", ") : "Без команды";
      const cur = map.get(bid) || { bid, name, count: 0 };
      cur.count += 1;
      if (cur.name === "Без команды" && name !== "Без команды") cur.name = name;
      map.set(bid, cur);
    }
    if (!sawRealBranch) looseCount += 1;
  }
  const branches = [...map.values()].sort((a, b) => b.count - a.count);
  if (looseCount > 0) {
    branches.push({ bid: null, name: "Все главы", count: chapters.length });
  }
  return branches;
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
