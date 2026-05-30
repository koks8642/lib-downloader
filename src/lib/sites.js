// Определение сайта группы Lib по hostname и нужные параметры для API.
// Все Lib-сайты ходят в общий backend api.cdnlibs.org, различаясь заголовком Site-Id.

// color — фирменный акцент сайта (применяется к теме панели).
export const SITES = {
  "ranobelib.me":  { id: 3, kind: "novel", name: "RanobeLib", color: "#2196f3" },
  "mangalib.me":   { id: 1, kind: "manga", name: "MangaLib", color: "#ff9100" },
  "mangalib.org":  { id: 1, kind: "manga", name: "MangaLib", color: "#ff9100" },
  "hentailib.me":  { id: 4, kind: "manga", name: "HentaiLib", color: "#f44336" },
  "hentailib.org": { id: 4, kind: "manga", name: "HentaiLib", color: "#f44336" },
  "slashlib.me":   { id: 2, kind: "manga", name: "SlashLib", color: "#d81b60" },
  "yaoilib.me":    { id: 2, kind: "manga", name: "YaoiLib", color: "#d81b60" },
};

export const API_HOST = "https://api.cdnlibs.org/api";

// По URL вкладки понять: какой сайт + slug книги (если открыта книга).
// Примеры URL:
//   https://ranobelib.me/ru/book/214126--slug?...
//   https://ranobelib.me/ru/214126--slug/read/v1/c1?...
//   https://mangalib.me/ru/manga/12345--slug?...
export function parseTab(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  const site = SITES[host];
  if (!site) return null;

  // slug ищем в сегментах пути: первый сегмент вида "<digits>--<...>"
  const segs = u.pathname.split("/").filter(Boolean);
  let slug = null;
  for (const s of segs) {
    if (/^\d+--/.test(s)) { slug = s; break; }
  }
  // bid из query (?bid=...) если есть
  const bid = u.searchParams.get("bid");
  return { host, site, slug, bid: bid ? Number(bid) : null, url };
}
