// PDF download + text extraction (the pdfjs-dependent half of salary parsing).
// The pure line parser lives in ./parse-salary.js so it can be tested without
// pdfjs installed.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Fetch a signed PDF URL into memory. */
export async function downloadPdf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download PDF (${res.status} ${res.statusText})`);
  return new Uint8Array(await res.arrayBuffer());
}

// Glyph runs further apart than this (in PDF points) start a new table cell.
// Tune to the real PDF if columns are being split/merged wrongly.
const CELL_GAP = 18;

/**
 * Extract text as rows. Runs on the same baseline (y) are grouped into a row;
 * within a row, a large x-gap starts a new cell. Cells are joined with " | " so
 * the parser can tell columns apart (see parse-salary.js).
 */
export async function extractLines(data) {
  const doc = await getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
  const lines = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const rows = new Map(); // rounded-y -> [{ x, w, s }]
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = Math.round(item.transform[5]);
        if (!rows.has(y)) rows.set(y, []);
        rows.get(y).push({ x: item.transform[4], w: item.width || 0, s: item.str.trim() });
      }
      for (const y of [...rows.keys()].sort((a, b) => b - a)) {
        const items = rows.get(y).sort((a, b) => a.x - b.x);
        const cells = [];
        let curr = [];
        let prevRight = null;
        for (const it of items) {
          if (prevRight !== null && it.x - prevRight > CELL_GAP) {
            cells.push(curr.join(' '));
            curr = [];
          }
          curr.push(it.s);
          prevRight = it.x + it.w;
        }
        if (curr.length) cells.push(curr.join(' '));
        const line = cells.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
        if (line) lines.push(line);
      }
    }
  } finally {
    await doc.destroy();
  }
  return lines;
}
