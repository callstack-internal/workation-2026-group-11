// Band resolution against the REAL "Delivery 2026" PDF layout — the alias
// wiring and classification fallbacks the live CSV export needs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEmployee, resolveBand, applyLabelAliases } from '../ingest/build-rates.js';
import { parseSalarySection } from '../ingest/parse-salary.js';
import config from '../ingest/config.json' with { type: 'json' };

// Mirrors the actual PDF (subset): both contract types, all three categories.
const LINES = [
  'Salary ranges for Developers (B2B)',
  'From | To',
  'Expert | 33000 | 44000',
  'Senior 2 | 28000 | 35000',
  'Senior 1 | 21000 | 31000',
  'Salary ranges for QA’s (B2B)',
  'Senior QA Automation Engineer | 19000 | 27000',
  'QA Automation Engineer | 15000 | 19000',
  'Senior QA Manual Engineer | 14000 | 19500',
  'Salary ranges for Portfolio Team (B2B)',
  'Senior Business Analyst / Product | 21000 | 26000',
  'Owner',
  'Business Analyst / Product Owner | 18000 | 25000',
  'Senior Project Manager | 19000 | 26000',
  'Project Manager | 12000 | 18000',
  'Project Management Coordinator | 13000 | 16500',
];
const BANDS = parseSalarySection(LINES, { section: 'delivery', contractDefault: 'B2B' });

const emp = (over) => ({ firstName: 'A', lastName: 'B', title: 'B A', email: '', aliases: [], teams: ['Technical Delivery'], roleTags: [], ...over });
const resolve = (e) => resolveBand(BANDS, classifyEmployee(emp(e), config), { contractType: 'B2B' });

test('applyLabelAliases canonicalizes the CSV role variants (incl. the Managaer typo)', () => {
  assert.deepEqual(applyLabelAliases(['IT Project Manager', 'Senior'], config.labelAliases), ['Project Manager', 'Senior']);
  assert.deepEqual(applyLabelAliases(['Senior IT Project Managaer'], config.labelAliases), ['Senior Project Manager']);
});

test('"IT Project Manager, Senior" resolves to the Senior Project Manager band', () => {
  const b = resolve({ teams: ['Project Delivery'], roleTags: ['IT Project Manager', 'Senior'] });
  assert.equal(b.label, 'Senior Project Manager');
});

test('"Senior IT Project Managaer" (single tag, typo) resolves via alias', () => {
  const b = resolve({ teams: ['Project Delivery'], roleTags: ['Senior IT Project Managaer'] });
  assert.equal(b.label, 'Senior Project Manager');
});

test('"Product Owner" picks the non-senior BA/PO band', () => {
  const b = resolve({ teams: ['Project Delivery'], roleTags: ['Product Owner'] });
  assert.equal(b.label, 'Business Analyst / Product Owner');
});

test('"Project Management Coordinator" is not swallowed by the PM bands', () => {
  const b = resolve({ teams: ['Project Delivery'], roleTags: ['Project Management Coordinator'] });
  assert.equal(b.label, 'Project Management Coordinator');
});

test('"QA Manual Eng., Senior" matches Senior QA Manual Engineer', () => {
  const b = resolve({ roleTags: ['QA Manual Eng.', 'Senior'] });
  assert.equal(b.label, 'Senior QA Manual Engineer');
});

test('bare "Senior 2" on a delivery team falls back to a developer band', () => {
  const b = resolve({ roleTags: ['Senior 2'] });
  assert.equal(b.label, 'Senior 2');
  assert.equal(b.category, 'developers');
});

test('an empty Team cell with a dev role is treated as delivery, not business', () => {
  const c = classifyEmployee(emp({ teams: [], roleTags: ['RN Dev', 'Senior 2'] }), config);
  assert.equal(c.section, 'delivery');
  assert.equal(resolve({ teams: [], roleTags: ['RN Dev', 'Senior 2'] }).label, 'Senior 2');
});

test('a level embedded in the title ("Senior AI System Engineer") is used', () => {
  const c = classifyEmployee(emp({ roleTags: ['Senior AI System Engineer'] }), config);
  assert.equal(c.category, 'developers');
  assert.equal(c.level, 'Senior');
});

test('business-section roles stay unmatched (no Business PDF yet)', () => {
  assert.equal(resolve({ teams: ['Sales'], roleTags: ['Head of Sales'] }), null);
});
