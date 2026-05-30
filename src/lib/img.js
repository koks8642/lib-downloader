// Загрузка и подготовка изображений страниц.

const EXT_BY_TYPE = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
};

export async function fetchImage(url) {
  const r = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!r.ok) throw new Error(`HTTP ${r.status} (картинка)`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const type = r.headers.get("content-type") || "image/jpeg";
  const ext = EXT_BY_TYPE[type.split(";")[0].trim()] || (url.match(/\.(\w+)(?:\?|$)/)?.[1]) || "jpg";
  return { bytes: buf, ext, type };
}

// Перекодировать любое изображение в JPEG + размеры (для PDF).
export async function toJpegPage(bytes, type) {
  const blob = new Blob([bytes], { type: type || "image/jpeg" });
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  const jpeg = new Uint8Array(await out.arrayBuffer());
  return { jpeg, w: bmp.width, h: bmp.height };
}
