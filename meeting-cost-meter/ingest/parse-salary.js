// Pure salary parsing — no pdfjs / network — so it unit-tests against a text
// fixture without any dependency installed.
//
// Real "Delivery 2026" PDF layout (from `npm run ingest:dump-pdf`):
//   "Salary ranges for Developers (B2B)"     <- category header + contract type
//   "From | To"                              <- column header (noise)
//   "Expert | 33000 | 44000"                 <- data row: label | min | max
//   ...
//   "Senior Business Analyst / Product | 21000 | 26000"
//   "Owner"                                  <- wrapped continuation of the label
//   "CHAPTER TITLE | 2 2"                    <- noise (page number)
//
// Two keying schemes coexist: Developers rows are keyed by LEVEL only; QA /
// Portfolio rows are keyed by full role TITLE. Each category appears twice —
// once for (B2B) and once for (CoE) contract types with different amounts.
// `extractLines` (pdf.js) joins table cells with " | ".

const AMOUNT_RE = /\d{1,3}(?:[ .,]\d{3})+|\d{4,}/g;
const CURRENCY_RE = /\b(PLN|EUR|USD|GBP|CHF|zł|net|gross|brutto|netto)\b/gi;
const NOISE_LABEL_RE = /^(presentation\s*ti\s*tle|chapter\s*title|from\s*to|from|to|salary\s*ranges|delivery\s*team|business\s*team)$/i;

/** "12 000" / "12,000" / "33000" -> whole units. */
export function parseMoney(token) {
  const digits = String(token).replace(/[^\d]/g, '');
  return digits ? Number(digits) : NaN;
}

export function extractAmounts(text, minAmount = 1000) {
  return [...String(text).matchAll(AMOUNT_RE)]
    .map((m) => parseMoney(m[0]))
    .filter((n) => Number.isFinite(n) && n >= minAmount);
}

/** Everything on the line that isn't a money amount, currency word, or cell pipe. */
export function rowLabel(line) {
  return String(line)
    .replace(/\|/g, ' ')
    .replace(AMOUNT_RE, ' ')
    .replace(CURRENCY_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Detect "Salary ranges for <Category> (B2B|CoE)". */
export function parseCategoryHeader(line) {
  const m = String(line).match(/salary\s+ranges?\s+for\s+(.+?)\s*\((b2b|coe)\)/i);
  if (!m) return null;
  const contractType = /coe/i.test(m[2]) ? 'CoE' : 'B2B';
  return { category: normalizeCategory(m[1]), contractType };
}

export function normalizeCategory(name) {
  const n = String(name).toLowerCase();
  if (/qa|quality/.test(n)) return 'qa';
  if (/portfolio|analyst|product|project|scrum|coordinator/.test(n)) return 'portfolio';
  if (/develop|\bdev\b|engineer|programmer|architect/.test(n)) return 'developers';
  return n.replace(/[^a-z0-9]+/g, ' ').trim() || 'general';
}

function isLabelWrap(label) {
  if (!label || NOISE_LABEL_RE.test(label.trim())) return false;
  if (!/^[a-zà-ÿ][a-zà-ÿ /'’.-]*$/i.test(label)) return false; // letters/slashes only, no digits
  return label.split(/\s+/).length <= 3;
}

/**
 * Parse a whole section's lines into bands, tracking the current category +
 * contract type from headers. Handles noise rows and one-line label wraps.
 * @returns {{ section, category, contractType, label, min, max }[]}
 */
export function parseSalarySection(lines, { section, contractDefault = 'B2B', minAmount = 1000 } = {}) {
  const bands = [];
  let category = null;
  let contractType = null;
  let last = null;

  for (const line of lines) {
    const header = parseCategoryHeader(line);
    if (header) {
      category = header.category;
      contractType = header.contractType;
      last = null;
      continue;
    }

    const amounts = extractAmounts(line, minAmount);
    const label = rowLabel(line);

    if (amounts.length >= 2 && label && /[a-zà-ÿ]/i.test(label)) {
      last = {
        section,
        category: category || 'general',
        contractType: contractType || contractDefault,
        label,
        min: Math.min(...amounts),
        max: Math.max(...amounts),
      };
      bands.push(last);
      continue;
    }

    // Non-data line: maybe a wrapped continuation of the row just above it.
    if (last && amounts.length === 0 && isLabelWrap(label)) {
      last.label = `${last.label} ${label}`.replace(/\s+/g, ' ').trim();
    }
    last = null;
  }
  return bands;
}

/** Single-line parse used only by the dump helper for annotation. */
export function parseSalaryLine(line, opts = {}) {
  const bands = parseSalarySection([line], opts);
  return bands[0] || null;
}
