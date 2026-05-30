// Загрузка и подготовка изображений страниц.

const EXT_BY_TYPE = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
};

export async function fetchImage(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} (картинка)`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const type = r.headers.get("content-type") || "image/jpeg";
  const ext = EXT_BY_TYPE[type.split(";")[0].trim()] || (url.match(/\.(\w+)(?:\?|$)/)?.[1]) || "jpg";
  return { bytes: buf, ext, type };
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
