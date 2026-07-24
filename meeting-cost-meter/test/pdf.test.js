import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseMoney,
  extractAmounts,
  parseCategoryHeader,
  parseSalarySection,
} from '../ingest/parse-salary.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LINES = fs
  .readFileSync(path.join(HERE, 'fixtures/salary-sample.txt'), 'utf8')
  .split('\n')
  .filter(Boolean);
const BANDS = parseSalarySection(LINES, { section: 'delivery', contractDefault: 'B2B' });
const find = (cat, ct, labelRe) =>
  BANDS.find((b) => b.category === cat && b.contractType === ct && labelRe.test(b.label));

test('parseMoney handles separators and bare integers', () => {
  assert.equal(parseMoney('16 000'), 16000);
  assert.equal(parseMoney('12,000'), 12000);
  assert.equal(parseMoney('33000'), 33000);
});

test('extractAmounts ignores small numbers (level/page digits)', () => {
  assert.deepEqual(extractAmounts('Senior 1 | 21000 | 31000'), [21000, 31000]);
  assert.deepEqual(extractAmounts('CHAPTER TITLE | 2 2'), []);
});

test('parseCategoryHeader extracts category + contract type', () => {
  assert.deepEqual(parseCategoryHeader('Salary ranges for Developers (B2B)'), {
    category: 'developers',
    contractType: 'B2B',
  });
  assert.deepEqual(parseCategoryHeader("Salary ranges for QA’s (CoE)"), {
    category: 'qa',
    contractType: 'CoE',
  });
  assert.equal(parseCategoryHeader('From | To'), null);
});

test('noise rows never become bands', () => {
  assert.ok(!BANDS.some((b) => /presentation ti|chapter title|salary ranges|^(from|to)$/i.test(b.label)));
});

test('developers are keyed by level, split by contract type', () => {
  assert.deepEqual([find('developers', 'B2B', /^Expert$/).min, find('developers', 'B2B', /^Expert$/).max], [33000, 44000]);
  assert.deepEqual([find('developers', 'CoE', /^Expert$/).min, find('developers', 'CoE', /^Expert$/).max], [28000, 36500]);
});

test('QA rows are keyed by full title', () => {
  const b = find('qa', 'B2B', /Senior QA Automation Engineer/);
  assert.deepEqual([b.min, b.max], [19000, 27000]);
});

test('a wrapped role label is stitched back together', () => {
  const b = find('portfolio', 'B2B', /Business Analyst/);
  assert.match(b.label, /Product\s+Owner/); // "…/ Product" + "Owner"
});
