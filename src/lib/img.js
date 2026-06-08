// Загрузка и подготовка изображений страниц.
import { rateLimitedFetch } from "./api.js";

const EXT_BY_TYPE = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif",
};
const MIME_BY_EXT = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
};

// Определить формат по сигнатуре (magic bytes). Надёжнее content-type и URL:
// серверы Lib часто отдают картинки с неверным/пустым Content-Type, из-за чего
// файл сохранялся как .txt. Байты не врут.
function sniffExt(b) {
  if (!b || b.length < 12) return null;
  // RIFF .... WEBP
  if (b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46 &&
      b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50) return "webp";
  // JPEG: FF D8 FF
  if (b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF) return "jpg";
  // PNG: 89 50 4E 47
  if (b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47) return "png";
  // GIF: "GIF8"
  if (b[0]===0x47&&b[1]===0x49&&b[2]===0x46&&b[3]===0x38) return "gif";
  // AVIF/HEIF: ....ftyp + brand (avif/avis/heic...)
  if (b[4]===0x66&&b[5]===0x74&&b[6]===0x79&&b[7]===0x70) {
    const brand = String.fromCharCode(b[8],b[9],b[10],b[11]).toLowerCase();
    if (brand.startsWith("avi")) return "avif";
  }
  return null;
}

export async function fetchImage(url) {
  const r = await rateLimitedFetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} (картинка)`);
  const bytes = new Uint8Array(await r.arrayBuffer());

  // 1) сигнатура → 2) content-type → 3) расширение в URL → 4) jpg
  let ext = sniffExt(bytes);
  if (!ext) {
    const ct = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    ext = EXT_BY_TYPE[ct]
       || (url.match(/\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i)?.[1] || "").toLowerCase()
       || "jpg";
    if (ext === "jpeg") ext = "jpg";
  }
  const type = MIME_BY_EXT[ext] || "image/jpeg";
  return { bytes, ext, type };
}

async function decode(bytes, type) {
  return createImageBitmap(new Blob([bytes], { type: type || "image/jpeg" }));
}

async function canvasJpeg(bmp, sx, sy, sw, sh, quality) {
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return new Uint8Array(await blob.arrayBuffer());
}

// Перекодировать в одну JPEG-страницу + размеры (для PDF).
export async function toJpegPage(bytes, type, quality = 0.9) {
  const bmp = await decode(bytes, type);
  const jpeg = await canvasJpeg(bmp, 0, 0, bmp.width, bmp.height, quality);
  return { jpeg, w: bmp.width, h: bmp.height };
}

// Автокадрирование: длинные страницы (выше A4-пропорции) режем по высоте
// на куски. Возвращает массив JPEG-страниц [{jpeg,w,h}].
// ratio — целевая пропорция h/w куска (A4 ≈ 1.414).
export async function splitToJpegPages(bytes, type, { enabled = true, ratio = 1.414, tol = 0.1, quality = 0.9 } = {}) {
  const bmp = await decode(bytes, type);
  const { width: w, height: h } = bmp;
  if (!enabled || h / w <= ratio * (1 + tol)) {
    const jpeg = await canvasJpeg(bmp, 0, 0, w, h, quality);
    return [{ jpeg, w, h }];
  }
  const sliceH = Math.round(w * ratio);
  const parts = [];
  for (let y = 0; y < h; y += sliceH) {
    const sh = Math.min(sliceH, h - y);
    const jpeg = await canvasJpeg(bmp, 0, y, w, sh, quality);
    parts.push({ jpeg, w, h: sh });
  }
  return parts;
}
