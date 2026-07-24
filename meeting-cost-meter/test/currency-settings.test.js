import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMcm } from './load-mcm.js';

const { currency, settings } = loadMcm(
  'extension/shared/settings.js',
  'extension/content/currency.js',
);

test('PLN/USD conversion uses PLN per USD in the correct direction', () => {
  assert.equal(currency.convert(40, 'PLN', 'USD', 4), 10);
  assert.equal(currency.convert(10, 'USD', 'PLN', 4), 40);
  assert.equal(currency.convert(12, 'PLN', 'PLN', null), 12);
});

test('cross-currency conversion refuses to guess without an official quote', () => {
  assert.equal(currency.convert(40, 'PLN', 'USD', null), null);
  assert.equal(currency.convert(40, 'EUR', 'USD', 4), null);
});

test('alert ranges use strict USD thresholds and red is the highest level', () => {
  const ranges = { yellow: 10, orange: 20, red: 30 };
  assert.equal(settings.alertLevel(10, ranges), 'green');
  assert.equal(settings.alertLevel(10.01, ranges), 'yellow');
  assert.equal(settings.alertLevel(20.01, ranges), 'orange');
  assert.equal(settings.alertLevel(30.01, ranges), 'red');
  assert.equal(settings.alertLevel(null, ranges), 'unavailable');
});

test('invalid or descending alert thresholds are normalized in one config', () => {
  assert.deepEqual(
    { ...settings.alertThresholds({ yellow: 12, orange: 5, red: 2 }) },
    { yellow: 12, orange: 12, red: 12 },
  );
});
