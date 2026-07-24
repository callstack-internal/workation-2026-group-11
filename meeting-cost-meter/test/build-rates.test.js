import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyEmployee,
  resolveBand,
  buildRates,
  roundSig,
  normalizeContractType,
} from '../ingest/build-rates.js';
import { parseSalarySection } from '../ingest/parse-salary.js';
import config from '../ingest/config.json' with { type: 'json' };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANDS = parseSalarySection(
  fs.readFileSync(path.join(HERE, 'fixtures/salary-sample.txt'), 'utf8').split('\n').filter(Boolean),
  { section: 'delivery', contractDefault: 'B2B' },
);

const emp = (over) => ({ firstName: 'A', lastName: 'B', title: 'B A', email: '', aliases: [], teams: ['Technical Delivery'], roleTags: [], ...over });

test('classifyEmployee: developer -> category developers + level', () => {
  const c = classifyEmployee(emp({ roleTags: ['RN Dev', 'Senior 1'] }), config);
  assert.equal(c.category, 'developers');
  assert.equal(c.level, 'Senior 1');
});

test('classifyEmployee: QA and Portfolio categories', () => {
  assert.equal(classifyEmployee(emp({ roleTags: ['QA Automation Eng.', 'Senior'] }), config).category, 'qa');
  assert.equal(classifyEmployee(emp({ teams: ['Project Delivery'], roleTags: ['Project Manager'] }), config).category, 'portfolio');
});

test('classifyEmployee picks the most senior level tag', () => {
  assert.equal(classifyEmployee(emp({ roleTags: ['RN Dev', 'Senior 1', 'Expert'] }), config).level, 'Expert');
});

test('resolveBand: developer keyed by level, honoring contractType', () => {
  const c = classifyEmployee(emp({ roleTags: ['RN Dev', 'Expert'] }), config);
  assert.deepEqual(resolveBand(BANDS, c, { contractType: 'B2B' }), BANDS.find((b) => b.category === 'developers' && b.contractType === 'B2B' && b.label === 'Expert'));
  assert.equal(resolveBand(BANDS, c, { contractType: 'CoE' }).min, 28000);
});

test('resolveBand: average blends B2B and CoE', () => {
  const c = classifyEmployee(emp({ roleTags: ['RN Dev', 'Expert'] }), config);
  const avg = resolveBand(BANDS, c, { contractType: 'average' });
  assert.equal(avg.min, (33000 + 28000) / 2);
  assert.equal(avg.max, (44000 + 36500) / 2);
});

test('resolveBand: QA matches full title via fuzzy tokens ("Eng." ~ "Engineer")', () => {
  const c = classifyEmployee(emp({ roleTags: ['QA Automation Eng.', 'Senior'] }), config);
  const b = resolveBand(BANDS, c, { contractType: 'B2B' });
  assert.match(b.label, /Senior QA Automation Engineer/);
  assert.deepEqual([b.min, b.max], [19000, 27000]);
});

test('roundSig keeps significant digits', () => {
  assert.equal(roundSig(1.2345, 2), 1.2);
  assert.equal(roundSig(0.0456, 2), 0.046);
});

test('buildRates: matched gets a rate, unmatched is flagged, email baked as key', () => {
  const employees = [
    emp({ firstName: 'Ada', lastName: 'Lovelace', title: 'Lovelace Ada', email: 'ada.lovelace@example.test', roleTags: ['RN Dev', 'Senior 1'], contractType: 'B2B' }),
    emp({ firstName: 'Bob', lastName: 'NoBand', title: 'NoBand Bob', teams: ['Sales'], roleTags: ['Mystery Role'] }),
  ];
  const res = buildRates({ employees, salaryTable: BANDS, config });
  assert.equal(res.people.length, 1);
  assert.equal(res.unmatched.length, 1);
  // Senior 1 B2B mid = (21000+31000)/2 = 26000 /mo * 12 / (2016*60)
  const expected = roundSig((26000 * 12) / (config.hoursPerYear * 60), config.rateRoundingSignificantDigits);
  assert.equal(res.people[0].ratePerMinute, expected);
  assert.ok(res.people[0].keys.includes('ada lovelace'));
  assert.ok(res.people[0].keys.includes('ada.lovelace@example.test'));
  assert.equal(res.people[0].estimated, false);
  assert.equal(res.defaultRatePerMinute, null);
});

test('buildRates marks the configured average contract assumption as estimated', () => {
  const res = buildRates({
    employees: [emp({ roleTags: ['RN Dev', 'Senior 1'] })],
    salaryTable: BANDS,
    config: { ...config, contractType: 'average' },
  });
  assert.equal(res.people.length, 1);
  assert.equal(res.people[0].estimated, true);
  assert.equal(res.estimatedCount, 1);
});

test('fallback rate exists only when an explicit company annual figure is configured', () => {
  const noFallback = buildRates({ employees: [], salaryTable: BANDS, config });
  assert.equal(noFallback.defaultRatePerMinute, null);

  const withFallback = buildRates({
    employees: [],
    salaryTable: BANDS,
    config: { ...config, fallbackAnnualGross: 120_000 },
  });
  assert.equal(
    withFallback.defaultRatePerMinute,
    roundSig(120_000 / (config.hoursPerYear * 60), config.rateRoundingSignificantDigits),
  );
});

test('normalizeContractType accepts common B2B and employment labels', () => {
  assert.equal(normalizeContractType('B2B'), 'B2B');
  assert.equal(normalizeContractType('Contract of Employment'), 'CoE');
  assert.equal(normalizeContractType('UoP'), 'CoE');
  assert.equal(normalizeContractType('unknown'), null);
});
