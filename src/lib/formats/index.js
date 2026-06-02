// Генераторы выходных форматов. Каждый принимает book и возвращает
// { filename, blob }.
//
// book = {
//   title, author, slug, siteName, lang ("ru"),
//   chapters: [{ number, name, paragraphs: [string] }]
// }

import { makeZip } from "../zip.js";

const xml = (s) => String(s).replace(/[<>&"']/g, c =>
  ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", '"':"&quot;", "'":"&apos;" }[c]));

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}

function chapterHeading(ch) {
  return ch.name ? `Глава ${ch.number} — ${ch.name}` : `Глава ${ch.number}`;
}

// ---------- TXT (один файл) ----------
export function buildTXT(book) {
  const parts = [book.title];
  if (book.author) parts.push(book.author);
  parts.push("");
  for (const ch of book.chapters) {
    parts.push("\n" + "=".repeat(50));
    parts.push(chapterHeading(ch));
    parts.push("=".repeat(50) + "\n");
    parts.push(ch.paragraphs.join("\n\n"));
  }
  const blob = new Blob([parts.join("\n")], { type: "text/plain;charset=utf-8" });
  return { filename: `${safeName(book.title)}.txt`, blob };
}

// ---------- Markdown ----------
export function buildMD(book) {
  const parts = [`# ${book.title}`];
  if (book.author) parts.push(`*${book.author}*`);
  for (const ch of book.chapters) {
    parts.push("", `## ${chapterHeading(ch)}`, "");
    parts.push(ch.paragraphs.join("\n\n"));
  }
  const blob = new Blob([parts.join("\n")], { type: "text/markdown;charset=utf-8" });
  return { filename: `${safeName(book.title)}.md`, blob };
}

// ---------- JSON ----------
export function buildJSON(book) {
  const data = {
    title: book.title, author: book.author || null,
    slug: book.slug, site: book.siteName,
    chapters: book.chapters.map(ch => ({
      number: ch.number, name: ch.name || null, paragraphs: ch.paragraphs,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  return { filename: `${safeName(book.title)}.json`, blob };
}

// ---------- FB2 ----------
export function buildFB2(book) {
  const bodies = book.chapters.map(ch => {
    const ps = ch.paragraphs.map(p => `<p>${xml(p)}</p>`).join("");
    return `<section><title><p>${xml(chapterHeading(ch))}</p></title>${ps}</section>`;
  }).join("");

  const fb2 =
`<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>fantasy</genre>
<author><nickname>${xml(book.author || "Lib Downloader")}</nickname></author>
<book-title>${xml(book.title)}</book-title>
<lang>${xml(book.lang || "ru")}</lang>
</title-info>
<document-info>
<author><nickname>Lib Downloader</nickname></author>
<program-used>Lib Downloader</program-used>
<id>${xml(book.slug || book.title)}</id>
</document-info>
</description>
<body>
<title><p>${xml(book.title)}</p></title>
${bodies}
</body>
</FictionBook>`;
  const blob = new Blob([fb2], { type: "application/x-fictionbook+xml;charset=utf-8" });
  return { filename: `${safeName(book.title)}.fb2`, blob };
}

// ---------- EPUB ----------
export function buildEPUB(book) {
  const uid = `urn:lib-downloader:${safeName(book.slug || book.title)}`;
  const chFiles = book.chapters.map((ch, i) => {
    const id = `chap_${String(i + 1).padStart(4, "0")}`;
    const body = ch.paragraphs.map(p => `<p>${xml(p)}</p>`).join("\n");
    const xhtml =
`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<title>${xml(chapterHeading(ch))}</title><meta charset="utf-8"/></head>
<body><h2>${xml(chapterHeading(ch))}</h2>
${body}
</body></html>`;
    return { id, href: `${id}.xhtml`, title: chapterHeading(ch), xhtml };
  });

  const manifestItems = chFiles
    .map(c => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`).join("\n");
  const spineItems = chFiles.map(c => `<itemref idref="${c.id}"/>`).join("\n");

  const opf =
`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${xml(uid)}</dc:identifier>
<dc:title>${xml(book.title)}</dc:title>
<dc:creator>${xml(book.author || "Lib Downloader")}</dc:creator>
<dc:language>${xml(book.lang || "ru")}</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifestItems}
</manifest>
<spine toc="ncx">
${spineItems}
</spine>
</package>`;

  const navList = chFiles.map(c => `<li><a href="${c.href}">${xml(c.title)}</a></li>`).join("\n");
  const nav =
`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head>
<title>Оглавление</title><meta charset="utf-8"/></head>
<body><nav epub:type="toc"><h1>Оглавление</h1><ol>
${navList}
</ol></nav></body></html>`;

  const ncxPoints = chFiles.map((c, i) =>
`<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${xml(c.title)}</text></navLabel><content src="${c.href}"/></navPoint>`).join("\n");
  const ncx =
`<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${xml(uid)}"/></head>
<docTitle><text>${xml(book.title)}</text></docTitle>
<navMap>
${ncxPoints}
</navMap></ncx>`;

  const container =
`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

  const entries = [
    { name: "mimetype", data: "application/epub+zip" }, // ДОЛЖЕН быть первым
    { name: "META-INF/container.xml", data: container },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    { name: "OEBPS/toc.ncx", data: ncx },
    ...chFiles.map(c => ({ name: `OEBPS/${c.href}`, data: c.xhtml })),
  ];
  const blob = makeZip(entries);
  return { filename: `${safeName(book.title)}.epub`, blob };
}

export const BUILDERS = {
  txt:  buildTXT,
  md:   buildMD,
  json: buildJSON,
  fb2:  buildFB2,
  epub: buildEPUB,
};

export { safeName };
