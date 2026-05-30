// Генератор MOBI (формат Kindle). Чистый JS, без зависимостей.
// Текстовая новелла → валидный MOBI6 (PalmDOC, без сжатия) + EXTH (автор/заголовок).

const te = new TextEncoder();

function strBytes(s) { return te.encode(String(s)); }

function chapterHeading(ch) {
  return ch.name ? `Глава ${ch.number} — ${ch.name}` : `Глава ${ch.number}`;
}
function esc(s) {
  return String(s).replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}
function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
}

// Простой растущий буфер с big-endian записью.
class Buf {
  constructor() { this.parts = []; this.len = 0; }
  u8(v) { this.parts.push(Uint8Array.of(v & 0xff)); this.len += 1; }
  u16(v) { this.parts.push(Uint8Array.of((v >> 8) & 0xff, v & 0xff)); this.len += 2; }
  u32(v) {
    this.parts.push(Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff));
    this.len += 4;
  }
  raw(arr) { const a = arr instanceof Uint8Array ? arr : Uint8Array.from(arr); this.parts.push(a); this.len += a.length; }
  fill(byte, n) { if (n > 0) { this.raw(new Uint8Array(n).fill(byte)); } }
  bytes() {
    const out = new Uint8Array(this.len); let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

const PADDING = 4;
function padTo(n, mult = PADDING) { return (mult - (n % mult)) % mult; }

// EXTH-запись (тип, данные).
function exthRecord(type, dataBytes) {
  const b = new Buf();
  b.u32(type);
  b.u32(8 + dataBytes.length);
  b.raw(dataBytes);
  return b.bytes();
}

export function buildMOBI(book) {
  // 1) Полный текст книги как HTML.
  const htmlParts = [`<html><head><guide></guide></head><body>`];
  book.chapters.forEach((ch, i) => {
    if (i > 0) htmlParts.push(`<mbp:pagebreak/>`);
    htmlParts.push(`<h2>${esc(chapterHeading(ch))}</h2>`);
    for (const p of ch.paragraphs) htmlParts.push(`<p>${esc(p)}</p>`);
  });
  htmlParts.push(`</body></html>`);
  const textBytes = strBytes(htmlParts.join(""));
  const textLen = textBytes.length;

  // 2) Разбить текст на записи по 4096 (без сжатия).
  const RECSIZE = 4096;
  const textRecords = [];
  for (let off = 0; off < textLen; off += RECSIZE) {
    textRecords.push(textBytes.subarray(off, Math.min(off + RECSIZE, textLen)));
  }
  if (textRecords.length === 0) textRecords.push(new Uint8Array(0));
  const nTextRecs = textRecords.length;

  // 3) Запись 0: PalmDOC header + MOBI header + EXTH + title.
  const title = book.title || book.slug || "Книга";
  const author = book.author || "Lib Downloader";
  const titleBytes = strBytes(title);

  const rec0 = new Buf();
  // --- PalmDOC header (16 байт) ---
  rec0.u16(1);            // compression: 1 = без сжатия
  rec0.u16(0);            // unused
  rec0.u32(textLen);      // длина несжатого текста
  rec0.u16(nTextRecs);    // число текстовых записей
  rec0.u16(RECSIZE);      // размер записи
  rec0.u16(0);            // encryption: нет
  rec0.u16(0);            // unused

  // --- MOBI header ---
  const MOBI_HEADER_LEN = 232;
  const uniqueId = (Date.now() & 0x7fffffff) >>> 0;
  // EXTH соберём отдельно, чтобы знать fullNameOffset.
  const exth = new Buf();
  const exthRecords = [
    exthRecord(100, strBytes(author)), // author
    exthRecord(503, titleBytes),       // updated title
    exthRecord(104, strBytes(book.slug || "")), // isbn-ish (необяз.)
  ];
  let exthBody = new Buf();
  for (const r of exthRecords) exthBody.raw(r);
  // EXTH контейнер: "EXTH" + len + count + body + padding
  exth.raw(strBytes("EXTH"));
  const exthLen = 12 + exthBody.len;
  const exthPad = padTo(exthLen);
  exth.u32(exthLen + exthPad);
  exth.u32(exthRecords.length);
  exth.raw(exthBody.bytes());
  exth.fill(0, exthPad);

  // fullName идёт сразу после EXTH.
  const fullNameOffset = 16 /*palmdoc*/ + MOBI_HEADER_LEN + exth.len;

  const mobi = new Buf();
  mobi.raw(strBytes("MOBI"));        // identifier
  mobi.u32(MOBI_HEADER_LEN);         // header length
  mobi.u32(2);                       // mobi type: 2 = book
  mobi.u32(65001);                   // text encoding: UTF-8
  mobi.u32(uniqueId);                // unique id
  mobi.u32(6);                       // file version
  // reserved: 40 байт 0xFF (orth/infl index = none)
  for (let i = 0; i < 10; i++) mobi.u32(0xffffffff);
  mobi.u32(nTextRecs + 1);           // first non-book index (после текста)
  mobi.u32(fullNameOffset);          // full name offset
  mobi.u32(titleBytes.length);       // full name length
  mobi.u32(9);                       // locale: en
  mobi.u32(0);                       // input language
  mobi.u32(0);                       // output language
  mobi.u32(6);                       // min version
  mobi.u32(0);                       // first image index (нет картинок)
  mobi.u32(0);                       // huffman record offset
  mobi.u32(0);                       // huffman record count
  mobi.u32(0);                       // huffman table offset
  mobi.u32(0);                       // huffman table length
  mobi.u32(0x40);                    // EXTH flags: 0x40 = есть EXTH
  // добить заголовок до MOBI_HEADER_LEN
  const mobiSoFar = mobi.len;        // от "MOBI"
  mobi.fill(0, MOBI_HEADER_LEN - mobiSoFar);

  // Собираем запись 0.
  rec0.raw(mobi.bytes());
  rec0.raw(exth.bytes());
  rec0.raw(titleBytes);
  rec0.fill(0, 2 + padTo(rec0.len)); // небольшой хвост-паддинг

  // 4) Доп. записи: FLIS, FCIS, EOF — для совместимости.
  const flis = (() => {
    const b = new Buf();
    b.raw(strBytes("FLIS"));
    b.u32(8); b.u16(65); b.u16(0); b.u32(0); b.u32(0xffffffff);
    b.u16(1); b.u16(3); b.u32(3); b.u32(1); b.u32(0xffffffff);
    return b.bytes();
  })();
  const fcis = (() => {
    const b = new Buf();
    b.raw(strBytes("FCIS"));
    b.u32(20); b.u32(16); b.u32(1); b.u32(0); b.u32(textLen);
    b.u32(0); b.u32(32); b.u32(8); b.u16(1); b.u16(1); b.u32(0);
    return b.bytes();
  })();
  const eof = Uint8Array.of(0xe9, 0x8e, 0x0d, 0x0a);

  // 5) Список всех записей по порядку.
  const records = [rec0.bytes(), ...textRecords, flis, fcis, eof];
  const nRecords = records.length;

  // 6) PalmDB header + таблица записей.
  const pdb = new Buf();
  let nameBytes = strBytes(safeName(title));
  if (nameBytes.length > 31) nameBytes = nameBytes.subarray(0, 31); // ровно ≤31 байт
  pdb.raw(nameBytes);
  pdb.fill(0, 32 - nameBytes.length);     // имя БД (32 байта, null-terminated)
  pdb.u16(0);                              // attributes
  pdb.u16(0);                              // version
  const now = Math.floor(Date.now() / 1000) + 2082844800; // Palm epoch (1904)
  pdb.u32(now);                            // creation
  pdb.u32(now);                            // modification
  pdb.u32(0);                              // last backup
  pdb.u32(0);                              // modification number
  pdb.u32(0);                              // appInfoID
  pdb.u32(0);                              // sortInfoID
  pdb.raw(strBytes("BOOK"));               // type
  pdb.raw(strBytes("MOBI"));               // creator
  pdb.u32(uniqueId);                       // unique id seed
  pdb.u32(0);                              // next record list id
  pdb.u16(nRecords);                       // number of records

  // Смещения записей: данные начинаются после header + таблицы + 2 байта.
  const headerSize = pdb.len + nRecords * 8 + 2;
  let offset = headerSize;
  const offsets = [];
  for (const r of records) { offsets.push(offset); offset += r.length; }

  for (let i = 0; i < nRecords; i++) {
    pdb.u32(offsets[i]);                   // record data offset
    pdb.u8(0);                             // attributes
    // uniqueID (3 байта)
    pdb.u8(0); pdb.u8((i >> 8) & 0xff); pdb.u8(i & 0xff);
  }
  pdb.u16(0);                              // gap to data (2 байта)

  // 7) Финал: header + все записи.
  const out = new Buf();
  out.raw(pdb.bytes());
  for (const r of records) out.raw(r);

  const blob = new Blob([out.bytes()], { type: "application/x-mobipocket-ebook" });
  return { filename: `${safeName(title)}.mobi`, blob };
}
