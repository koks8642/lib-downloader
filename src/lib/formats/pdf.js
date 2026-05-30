// Минимальный генератор PDF из JPEG-картинок (по странице на изображение).
// pages: [{ jpeg: Uint8Array, w, h }]. JPEG встраивается напрямую (DCTDecode).

function bytes(s) { return new TextEncoder().encode(s); }

export function imagesToPDF(pages) {
  const enc = [];
  let pos = 0;
  const offsets = [];
  const push = (data) => {
    const b = data instanceof Uint8Array ? data : bytes(data);
    enc.push(b); pos += b.length;
  };
  const obj = (n) => { offsets[n] = pos; };

  push("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

  // 1: Catalog, 2: Pages — заполним id потом
  const N = pages.length;
  const catalogId = 1, pagesId = 2;
  // объекты страниц/изображений/контента идут с 3
  const pageIds = [], imgIds = [], contentIds = [];
  let id = 3;
  for (let i = 0; i < N; i++) { pageIds.push(id++); imgIds.push(id++); contentIds.push(id++); }

  obj(catalogId);
  push(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`);

  obj(pagesId);
  push(`${pagesId} 0 obj\n<< /Type /Pages /Count ${N} /Kids [${pageIds.map(p => `${p} 0 R`).join(" ")}] >>\nendobj\n`);

  for (let i = 0; i < N; i++) {
    const { jpeg, w, h } = pages[i];
    // Page
    obj(pageIds[i]);
    push(`${pageIds[i]} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${w} ${h}] ` +
         `/Resources << /XObject << /Im0 ${imgIds[i]} 0 R >> >> /Contents ${contentIds[i]} 0 R >>\nendobj\n`);
    // Image XObject
    obj(imgIds[i]);
    push(`${imgIds[i]} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
         `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push("\nendstream\nendobj\n");
    // Content
    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`;
    obj(contentIds[i]);
    push(`${contentIds[i]} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`);
  }

  const xrefPos = pos;
  const total = id; // кол-во объектов + 1 (нулевой)
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) {
    xref += String(offsets[n] || 0).padStart(10, "0") + " 00000 n \n";
  }
  push(xref);
  push(`trailer\n<< /Size ${total} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  return new Blob(enc, { type: "application/pdf" });
}
