// Форматы для манги/манхвы. Работают с уже скачанными страницами.
// images: [{ ext, bytes:Uint8Array }] в порядке страниц.
import { makeZip } from "../zip.js";
import { imagesToPDF } from "./pdf.js";

function pad(i, n = 3) { return String(i).padStart(n, "0"); }

// CBZ = zip из картинок (читается всеми манга-ридерами).
export function buildCBZ(images, baseName) {
  const entries = images.map((img, i) => ({
    name: `${pad(i + 1)}.${img.ext || "jpg"}`,
    data: img.bytes,
  }));
  return { filename: `${baseName}.cbz`, blob: makeZip(entries) };
}

// PDF из картинок. jpegPages: [{jpeg:Uint8Array, w, h}] (готовые JPEG).
export function buildMangaPDF(jpegPages, baseName) {
  return { filename: `${baseName}.pdf`, blob: imagesToPDF(jpegPages) };
}
