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

test('compute integrates the escalating rate without repricing earlier minutes', () => {
  const r = cost.compute(10, 60, S);
  assert.equal(r.multiplier, 2.5);
  assert.equal(r.currentRatePerMin, 25);
  // 30 min × 1 plus 30 min under a linear 1→2.5 ramp.
  assert.equal(r.total, 10 * (30 + 30 * 1.75));
});

test('compute: no negative totals', () => {
  assert.equal(cost.compute(10, -5, S).total, 0);
});

test('integrateMultiplier includes the capped region exactly', () => {
  const settings = { thresholdMin: 10, alphaPerMin: 0.1, maxMultiplier: 2 };
  // 10 min at 1 + a 10 min 1→2 ramp + 10 min capped at 2.
  assert.equal(cost.integrateMultiplier(0, 30, settings), 10 + 15 + 20);
});

test('ledger keeps historical cost when the roster rate changes', () => {
  const ledger = cost.createLedger();
  const flat = { thresholdMin: 999, alphaPerMin: 0, maxMultiplier: 1 };

  ledger.update({ nowMs: 0, ratePerMinute: 10, hasPresence: true, settings: flat });
  let state = ledger.update({
    nowMs: 60_000,
    ratePerMinute: 20,
    hasPresence: true,
    settings: flat,
  });
  assert.equal(state.total, 10);

  state = ledger.update({
    nowMs: 120_000,
    ratePerMinute: 20,
    hasPresence: true,
    settings: flat,
  });
  assert.equal(state.total, 30); // 10 for minute one + 20 for minute two
});

test('ledger waits for a roster, pauses at zero presence, and never resets', () => {
  const ledger = cost.createLedger();
  const flat = { thresholdMin: 999, alphaPerMin: 0, maxMultiplier: 1 };

  let state = ledger.update({ nowMs: 60_000, ratePerMinute: 5, hasPresence: false, settings: flat });
  assert.equal(state.started, false);
  assert.equal(state.elapsedMin, 0);

  ledger.update({ nowMs: 120_000, ratePerMinute: 5, hasPresence: true, settings: flat });
  state = ledger.update({ nowMs: 180_000, ratePerMinute: 0, hasPresence: false, settings: flat });
  assert.equal(state.total, 5);
  state = ledger.update({ nowMs: 240_000, ratePerMinute: 0, hasPresence: false, settings: flat });
  assert.equal(state.total, 5);
  assert.equal(state.elapsedMin, 2);

  ledger.update({ nowMs: 300_000, ratePerMinute: 2, hasPresence: true, settings: flat });
  state = ledger.update({ nowMs: 360_000, ratePerMinute: 2, hasPresence: true, settings: flat });
  assert.equal(state.total, 7);
});

test('ledger snapshot restores the accumulated total', () => {
  const flat = { thresholdMin: 999, alphaPerMin: 0, maxMultiplier: 1 };
  const first = cost.createLedger();
  first.update({ nowMs: 0, ratePerMinute: 3, hasPresence: true, settings: flat });
  first.update({ nowMs: 120_000, ratePerMinute: 3, hasPresence: true, settings: flat });

  const restored = cost.createLedger(first.snapshot());
  const state = restored.update({
    nowMs: 180_000,
    ratePerMinute: 3,
    hasPresence: true,
    settings: flat,
  });
  assert.equal(state.total, 9);
  assert.equal(state.elapsedMin, 3);
});

test('ledger rebase resumes without charging or timing a paused gap', () => {
  const flat = { thresholdMin: 999, alphaPerMin: 0, maxMultiplier: 1 };
  const ledger = cost.createLedger();
  ledger.update({ nowMs: 0, ratePerMinute: 4, hasPresence: true, settings: flat });
  let state = ledger.update({
    nowMs: 60_000,
    ratePerMinute: 0,
    hasPresence: false,
    settings: flat,
  });
  assert.equal(state.total, 4);
  assert.equal(state.elapsedMin, 1);

  ledger.rebase(10 * 60_000, flat);
  ledger.update({
    nowMs: 10 * 60_000,
    ratePerMinute: 4,
    hasPresence: true,
    settings: flat,
  });
  state = ledger.update({
    nowMs: 11 * 60_000,
    ratePerMinute: 4,
    hasPresence: true,
    settings: flat,
  });
  assert.equal(state.total, 8);
  assert.equal(state.elapsedMin, 2);
});
