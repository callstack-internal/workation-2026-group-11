// Orchestrator: employees + salary PDFs -> extension/data/rates.json
//
// Two interchangeable sources (config.dataSource, or --local / --notion):
//   "notion" — Current Employees DB + salary-PDF attachments, via NOTION_TOKEN
//   "local"  — a CSV export of the employee DB + salary PDFs on disk; needs no
//              token at all (the no-Notion-permission path)
//
// Run:  npm run ingest              (uses config.dataSource)
//       npm run ingest -- --local   (force one source)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { csvToEmployees } from './csv.js';
import { extractLines } from './pdf.js';
import { parseSalarySection } from './parse-salary.js';
import { buildRates } from './build-rates.js';
import config from './config.json' with { type: 'json' };

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const OUT_PATH = path.join(ROOT, 'extension/data/rates.json');

export function resolveDataSource(config, argv = process.argv) {
  if (argv.includes('--local')) return 'local';
  if (argv.includes('--notion')) return 'notion';
  return config.dataSource || 'notion';
}

/** @returns {{ employees, pdfSources: [{ data, section, filename }] }} */
async function loadFromNotion() {
  const { createClient, fetchEmployees, fetchSalaryPdfLinks } = await import('./notion.js');
  const { downloadPdf } = await import('./pdf.js');
  const notion = createClient();

  console.log('Fetching employees from Notion…');
  const employees = await fetchEmployees(notion, config.employees.databaseId, config.properties);

  console.log('Fetching salary PDFs from Notion…');
  const links = await fetchSalaryPdfLinks(notion, config.salaryPage.pageId);
  const pdfSources = [];
  for (const link of links) {
    pdfSources.push({ data: await downloadPdf(link.url), section: link.section, filename: link.filename });
  }
  return { employees, pdfSources };
}

/** Same shape, but from a CSV export + PDFs on disk — no token needed. */
async function loadFromLocal() {
  const csvPath = path.resolve(ROOT, config.local.employeesCsv);
  console.log(`Reading employees from ${path.relative(ROOT, csvPath)}…`);
  const employees = csvToEmployees(fs.readFileSync(csvPath, 'utf8'), config.local.csvColumns);

  const pdfSources = [];
  for (const p of config.local.pdfs || []) {
    const abs = path.resolve(ROOT, p.path);
    if (!fs.existsSync(abs)) {
      if (p.optional) {
        console.warn(`Optional salary PDF not found: ${path.relative(ROOT, abs)} (${p.section})`);
        continue;
      }
      throw new Error(`Required salary PDF not found: ${path.relative(ROOT, abs)}`);
    }
    console.log(`Reading ${path.relative(ROOT, abs)} (${p.section})…`);
    pdfSources.push({
      data: new Uint8Array(fs.readFileSync(abs)),
      section: p.section,
      filename: path.basename(abs),
    });
  }
  return { employees, pdfSources };
}

async function main() {
  const source = resolveDataSource(config);
  const { employees, pdfSources } = source === 'local' ? await loadFromLocal() : await loadFromNotion();
  console.log(`  ${employees.length} employees (source: ${source})`);

  const salaryTable = [];
  for (const src of pdfSources) {
    const lines = await extractLines(src.data);
    const bands = parseSalarySection(lines, { section: src.section, contractDefault: config.contractType });
    const cats = [...new Set(bands.map((b) => `${b.category}/${b.contractType}`))].join(', ');
    console.log(`  ${src.filename} (${src.section}): ${bands.length} bands [${cats}] from ${lines.length} lines`);
    salaryTable.push(...bands);
  }

  if (salaryTable.length === 0) {
    console.warn('\n  ⚠  No salary bands parsed. Run `npm run ingest:dump-pdf` and tune ingest/pdf.js.');
  }

  const { people, defaultRatePerMinute, matchedCount, estimatedCount, unmatched } = buildRates({
    employees,
    salaryTable,
    config,
  });

  console.log(`\nMatched ${matchedCount}/${employees.length} employees to a salary band.`);
  if (estimatedCount) {
    console.log(
      `${estimatedCount} matched rates use the configured "${config.contractType}" contract-type assumption.`,
    );
  }
  if (unmatched.length) {
    const fallback = defaultRatePerMinute
      ? `will use the explicit ${defaultRatePerMinute} ${config.currency}/min fallback`
      : 'have no configured rate and will be excluded from cost with a visible warning';
    console.log(`${unmatched.length} without a band (${fallback}):`);
    for (const u of unmatched.slice(0, 25)) {
      console.log(`  - [${u.classified.section}] role="${u.classified.roleFamily}" level="${u.classified.level}"`);
    }
    if (unmatched.length > 25) console.log(`  … and ${unmatched.length - 25} more`);
  }

  const output = {
    generatedAt: new Date().toISOString().slice(0, 10),
    currency: config.currency,
    defaultRatePerMinute,
    coverage: {
      employeeCount: employees.length,
      matchedCount,
      estimatedCount,
      unmatchedCount: unmatched.length,
      contractTypeAssumption: config.contractType,
      hasExplicitFallback: defaultRatePerMinute != null,
    },
    people,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\n✓ Wrote ${path.relative(ROOT, OUT_PATH)} (${people.length} people, default ${defaultRatePerMinute} ${config.currency}/min).`);
  console.log('  Reminder: rates.json is gitignored — it is derived salary data.');
}

main().catch((err) => {
  console.error('\nIngest failed:', err.message);
  process.exit(1);
});
