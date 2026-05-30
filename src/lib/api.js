// Клиент API группы Lib (общий backend api.cdnlibs.org).
import { API_HOST } from "./sites.js";

function headers(siteId) {
  return {
    "Accept": "application/json",
    "Site-Id": String(siteId),
  };
}

async function getJSON(url, siteId) {
  const r = await fetch(url, { headers: headers(siteId) });
  if (!r.ok) throw new Error(`HTTP ${r.status} для ${url}`);
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

// Главы, относящиеся к выбранной ветке (bid). Если bid == null — берём все.
export function chaptersForBranch(chapters, bid) {
  return chapters
    .filter(ch =>
      bid == null ||
      (ch.branches || []).some(br => br.branch_id === bid))
    .map(ch => ({
      number: ch.number,
      numberFloat: parseFloat(ch.number),
      volume: ch.volume ?? "1",
      name: ch.name || "",
      id: ch.id,
    }))
    .sort((a, b) => (a.numberFloat - b.numberFloat) || 0);
}

// Контент одной главы. Для новелл вернёт {content}, для манги {pages}.
export async function fetchChapter(slug, siteId, { number, volume, bid }) {
  const q = new URLSearchParams({ number: String(number), volume: String(volume) });
  if (bid != null) q.set("branch_id", String(bid));
  const data = await getJSON(`${API_HOST}/manga/${slug}/chapter?${q}`, siteId);
  return data.data || data;
}
