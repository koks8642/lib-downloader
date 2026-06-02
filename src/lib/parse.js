// Парсинг контента главы.
// Контент новеллы у Lib приходит в одном из видов:
//   1) ProseMirror/TipTap JSON: { type:"doc", content:[ {type:"paragraph", content:[{type:"text",text:""}]} ] }
//   2) JSON-строка того же вида
//   3) HTML-строка

const SP = String.fromCharCode(32);   // обычный пробел
// Любой горизонтальный пробельный символ (таб, обычный/неразрывный/юникод-пробелы),
// но НЕ перевод строки. [^\S\n] = «пробельный, кроме \n».
const WS = /[^\S\n]+/g;

// ProseMirror -> массив абзацев (чистый текст, без разметки).
function pmToParagraphs(node, acc, cur) {
  if (Array.isArray(node)) { for (const n of node) pmToParagraphs(n, acc, cur); return; }
  if (!node || typeof node !== "object") return;
  switch (node.type) {
    case "text":
      cur.buf += node.text || "";
      break;
    case "hardBreak":
      cur.buf += "\n";
      break;
    case "paragraph":
    case "heading": {
      const inner = { buf: "" };
      pmToParagraphs(node.content || [], acc, inner);
      acc.push(inner.buf);
      break;
    }
    default:
      pmToParagraphs(node.content || [], acc, cur);
  }
}

// Повторы пробельных символов → один обычный пробел; убрать отступы вокруг
// переносов; не более одной пустой строки. Чинит большие отступы после тире
// в диалогах («—\t\tПривет» → «— Привет»).
function normalizeParagraph(p) {
  return String(p)
    .replace(WS, SP)
    .replace(new RegExp(SP + "*\\n" + SP + "*", "g"), "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlToParagraphs(html) {
  const s = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, SP).replace(/&laquo;/g, "«").replace(/&raquo;/g, "»")
    .replace(/&mdash;/g, "—").replace(/&hellip;/g, "…").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s.split("\n").map(normalizeParagraph).filter(Boolean);
}

// Главный экспорт: вернуть массив абзацев (строк) из любого вида контента.
export function contentToParagraphs(raw) {
  if (raw && typeof raw === "object") {
    const acc = [];
    pmToParagraphs(raw, acc, { buf: "" });
    return acc.map(normalizeParagraph).filter(Boolean);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try { return contentToParagraphs(JSON.parse(s)); } catch { /* fallthrough */ }
    }
    return htmlToParagraphs(s);
  }
  return [];
}
