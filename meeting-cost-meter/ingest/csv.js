// CSV-based employee source — the no-Notion-token alternative to notion.js.
//
// Any Notion member can do "••• → Export → CSV" on the Current Employees
// database without an integration token; this module turns that export into
// the same employee shape `mapEmployee` (notion.js) produces, so everything
// downstream (classify/resolve/buildRates) is source-agnostic.
//
// Pure functions, no fs — the caller reads the file (see index.js) so this
// parses in unit tests without touching disk.

/** RFC-4180-ish parser: quoted fields, "" escapes, CR/LF/CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '').replace(/^﻿/, ''); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const splitTags = (cell) =>
  String(cell || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Map a CSV export (header row + data rows) to employee records using
 * `columns` = {
 *   firstName, lastName, email, team, roleSeniority, alias?, contractType?
 * }
 * (values are the CSV header names). Multi-value cells (teams, role/seniority)
 * are comma-separated inside one quoted cell — split back into tags.
 */
export function csvToEmployees(text, columns) {
  const rows = parseCsv(text);
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  const col = {};
  for (const [field, name] of Object.entries(columns || {})) {
    const idx = header.indexOf(name);
    if (idx !== -1) col[field] = idx;
  }
  for (const required of ['firstName', 'lastName', 'email']) {
    if (!(required in col)) {
      throw new Error(
        `CSV is missing the "${(columns || {})[required] || required}" column. Header: ${header.join(', ')}`,
      );
    }
  }
  const cell = (row, field) => (col[field] != null ? String(row[col[field]] || '').trim() : '');

  const employees = [];
  for (const row of rows.slice(1)) {
    const firstName = cell(row, 'firstName');
    const lastName = cell(row, 'lastName');
    const email = cell(row, 'email');
    if (!firstName && !lastName && !email) continue; // placeholder row

    const alias = cell(row, 'alias');
    employees.push({
      firstName,
      lastName,
      // Notion's title property stores "Surname Name"; synthesize the same so
      // buildKeys bakes an identical key set from either source.
      title: [lastName, firstName].filter(Boolean).join(' '),
      email,
      aliases: alias ? splitTags(alias) : [],
      teams: splitTags(cell(row, 'team')),
      roleTags: splitTags(cell(row, 'roleSeniority')),
      contractType: cell(row, 'contractType'),
    });
  }
  return employees;
}
