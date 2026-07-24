// Dev helper: print the extracted text of each salary PDF, one numbered line
// per row, so you can see the real layout and tune ingest/pdf.js + config.json.
//
// Run:  npm run ingest:dump-pdf

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractLines } from './pdf.js';
import { parseSalarySection } from './parse-salary.js';
import config from './config.json' with { type: 'json' };

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

async function getPdfSources() {
  const useLocal = process.argv.includes('--local') || (!process.argv.includes('--notion') && config.dataSource === 'local');
  if (useLocal) {
    const sources = [];
    for (const p of config.local?.pdfs || []) {
      const abs = path.resolve(ROOT, p.path);
      if (!fs.existsSync(abs)) {
        if (p.optional) {
          console.warn(`Optional salary PDF not found: ${path.relative(ROOT, abs)} (${p.section})`);
          continue;
        }
        throw new Error(`Required salary PDF not found: ${path.relative(ROOT, abs)}`);
      }
      sources.push({
        data: new Uint8Array(fs.readFileSync(abs)),
        section: p.section,
        filename: path.basename(abs),
      });
    }
    return sources;
  }
  const { createClient, fetchSalaryPdfLinks } = await import('./notion.js');
  const { downloadPdf } = await import('./pdf.js');
  const notion = createClient();
  const links = await fetchSalaryPdfLinks(notion, config.salaryPage.pageId);
  const sources = [];
  for (const link of links) {
    sources.push({ data: await downloadPdf(link.url), section: link.section, filename: link.filename });
  }
  return sources;
}

async function main() {
  const sources = await getPdfSources();
  if (!sources.length) {
    console.log('No salary PDFs found (Notion page attachments or config.local.pdfs).');
    return;
  }
  for (const link of sources) {
    console.log(`\n===== ${link.filename} (section: ${link.section}) =====`);
    const lines = await extractLines(link.data);
    lines.forEach((line, i) => console.log(String(i).padStart(3, '0'), line));

    const bands = parseSalarySection(lines, { section: link.section, contractDefault: config.contractType });
    console.log(`\n  --- parsed ${bands.length} bands ---`);
    for (const b of bands) {
      console.log(`  [${b.category}/${b.contractType}] "${b.label}" ${b.min}-${b.max}`);
    }
  }
}

main().catch((err) => {
  console.error('dump-pdf failed:', err.message);
  process.exit(1);
});
