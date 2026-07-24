import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMcm } from './load-mcm.js';

const { cost } = loadMcm('extension/content/cost.js');
const S = { thresholdMin: 30, alphaPerMin: 0.05, maxMultiplier: 4 };

test('multiplier is 1 within the grace period', () => {
  assert.equal(cost.multiplier(0, S), 1);
  assert.equal(cost.multiplier(15, S), 1);
  assert.equal(cost.multiplier(30, S), 1);
});

test('multiplier ramps after the threshold', () => {
  assert.equal(cost.multiplier(45, S), 1.75); // 1 + 0.05*15
  assert.equal(cost.multiplier(60, S), 2.5); // 1 + 0.05*30
});

test('multiplier is capped at maxMultiplier', () => {
  assert.equal(cost.multiplier(10000, S), 4);
});

test('compute: total = base * elapsed * multiplier', () => {
  const r = cost.compute(10, 60, S); // base 10/min, 60 min, m=2.5
  assert.equal(r.multiplier, 2.5);
  assert.equal(r.currentRatePerMin, 25);
  assert.equal(r.total, 10 * 60 * 2.5);
});

test('compute: no negative totals', () => {
  assert.equal(cost.compute(10, -5, S).total, 0);
});
