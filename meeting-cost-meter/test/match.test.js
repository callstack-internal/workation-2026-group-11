import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMcm } from './load-mcm.js';

const { match } = loadMcm('extension/content/match.js');

const person = (full, rate) => ({
  keys: [match.normalizeName(full), match.tokenKey(full)],
  ratePerMinute: rate,
});

test('normalizeName: case, diacritics, Polish ł, parentheticals', () => {
  assert.equal(match.normalizeName('Zofia Wójcik (You)'), 'zofia wojcik');
  assert.equal(match.normalizeName('Paweł Łukasz'), 'pawel lukasz');
  assert.equal(match.normalizeName('  Grace   HOPPER '), 'grace hopper');
});

test('tokenKey is order-independent', () => {
  assert.equal(match.tokenKey('Ada Lovelace'), match.tokenKey('Lovelace Ada'));
});

test('matchParticipants matches regardless of name order and (You) suffix', () => {
  const rates = {
    defaultRatePerMinute: 1.1,
    people: [person('Ada Lovelace', 1.9), person('Alan Turing', 2.1)],
  };
  const index = match.buildIndex(rates);
  const r = match.matchParticipants(['Lovelace Ada (You)', 'Alan Turing'], rates, index);
  assert.equal(r.matched, 2);
  assert.equal(r.total, 2);
  assert.equal(r.ratePerMinuteTotal, 4.0);
});

test('unmatched attendees fall back to the default rate', () => {
  const rates = { defaultRatePerMinute: 1.1, people: [person('Ada Lovelace', 1.9)] };
  const index = match.buildIndex(rates);
  const r = match.matchParticipants(['Ada Lovelace', 'Some External Guest'], rates, index);
  assert.equal(r.matched, 1);
  assert.equal(r.total, 2);
  assert.equal(Math.round(r.ratePerMinuteTotal * 100) / 100, 3.0); // 1.9 + 1.1
  assert.equal(r.details.find((d) => d.name === 'Some External Guest').isMatch, false);
  assert.equal(r.fallback, 1);
  assert.equal(r.estimated, 1);
});

test('unknown attendees are excluded and flagged when no explicit fallback exists', () => {
  const rates = { defaultRatePerMinute: null, people: [person('Ada Lovelace', 1.9)] };
  const index = match.buildIndex(rates);
  const r = match.matchParticipants(['Ada Lovelace', 'Some External Guest'], rates, index);
  assert.equal(r.ratePerMinuteTotal, 1.9);
  assert.equal(r.unknown, 1);
  assert.equal(r.fallback, 0);
  assert.equal(r.details[1].rateKnown, false);
});

test('matched contract-assumption rates are counted as estimates', () => {
  const rates = {
    defaultRatePerMinute: null,
    people: [{ ...person('Ada Lovelace', 1.9), estimated: true }],
  };
  const r = match.matchParticipants(
    ['Ada Lovelace'],
    rates,
    match.buildIndex(rates),
  );
  assert.equal(r.matched, 1);
  assert.equal(r.estimated, 1);
  assert.equal(r.fallback, 0);
});
