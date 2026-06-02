// Сайты группы Lib. Все ходят в общий backend api.cdnlibs.org, различаясь
// заголовком Site-Id. Определяем сайт по «корню» домена (stem) — по метке
// hostname, а не по конкретному TLD. Так расширение работает на ЛЮБЫХ доменах
// и зеркалах Lib (.me, .org и будущих) без правок кода.
//
// Site-Id по типу контента:
//   1 — MangaLib (манга)         3 — RanobeLib (новеллы)
//   2 — SlashLib / YaoiLib       4 — HentaiLib
// AnimeLib (видео) сознательно не поддерживается — там нет глав для скачивания.

const LIBS = [
  { stem: "ranobelib", id: 3, kind: "novel", name: "RanobeLib", color: "#2196f3" },
  { stem: "mangalib",  id: 1, kind: "manga", name: "MangaLib", color: "#ff9100" },
  { stem: "hentailib", id: 4, kind: "manga", name: "HentaiLib", color: "#e0314a" },
  { stem: "slashlib",  id: 2, kind: "manga", name: "SlashLib", color: "#d81b60" },
  { stem: "yaoilib",   id: 2, kind: "manga", name: "YaoiLib",  color: "#d81b60" },
];

export const API_HOST = "https://api.cdnlibs.org/api";

// Сайт по hostname: совпадение, если любая метка домена равна корню Lib.
// "mangalib.me" / "mangalib.org" / "test-front.mangalib.me" → MangaLib.
export function siteForHost(hostname) {
  const labels = String(hostname).replace(/^www\./, "").toLowerCase().split(".");
  for (const lib of LIBS) {
    if (labels.includes(lib.stem)) return lib;
  }
  return null;
}

// По URL вкладки: какой сайт + slug книги (если открыта книга).
// Примеры URL:
//   https://ranobelib.me/ru/book/214126--slug?...
//   https://ranobelib.me/ru/214126--slug/read/v1/c1?...
//   https://mangalib.me/ru/manga/12345--slug?...
export function parseTab(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const site = siteForHost(u.hostname);
  if (!site) return null;

  // slug ищем в сегментах пути: первый сегмент вида "<digits>--<...>"
  const segs = u.pathname.split("/").filter(Boolean);
  let slug = null;
  for (const s of segs) {
    if (/^\d+--/.test(s)) { slug = s; break; }
  }
  // bid из query (?bid=...) если есть
  const bid = u.searchParams.get("bid");
  return { host: u.hostname, site, slug, bid: bid ? Number(bid) : null, url };
}
