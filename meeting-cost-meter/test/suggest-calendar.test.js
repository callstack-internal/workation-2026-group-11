// suggestFor ("did you mean …?") and matchByCalendar (email-exact identity,
// scrape-as-presence) — the robustness-pack additions to match.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMcm } from './load-mcm.js';

const { match, mock } = loadMcm('extension/content/match.js', 'extension/content/mock.js');

const person = (full, rate, email) => ({
  keys: [match.normalizeName(full), match.tokenKey(full), ...(email ? [email] : [])],
  ratePerMinute: rate,
});

const RATES = {
  defaultRatePerMinute: 1.1,
  people: [
    person('Zofia Wójcik', 1.5, 'zofia.wojcik@example.test'),
    person('Jan Kowalski', 1.3, 'jan.kowalski@example.test'),
    person('Ada Lovelace', 1.9, 'ada.lovelace@example.test'),
  ],
};
const INDEX = match.buildIndex(RATES);
const KEYS = [...INDEX.keys()];

test('suggestFor surfaces a near-miss below the auto-accept threshold', () => {
  const s = match.suggestFor('Sofia Wojcik', KEYS, { floor: 0.5 });
  assert.ok(s.length >= 1);
  assert.equal(s[0].key, 'zofia wojcik');
});

test('suggestFor dedupes the "first last"/"last first" key pair per person', () => {
  const s = match.suggestFor('Zofia Wojik', KEYS);
  const people = s.map((x) => match.tokenKey(x.key));
  assert.equal(new Set(people).size, people.length);
});

test('suggestFor never suggests email keys and ignores tiny names', () => {
  for (const s of match.suggestFor('Jan Kowalsky', KEYS)) assert.ok(!s.key.includes('@'));
  assert.equal(match.suggestFor('J', KEYS).length, 0);
});

test('matchByCalendar never bills invitees when presence cannot be verified', () => {
  const invitees = [
    { email: 'ada.lovelace@example.test', responseStatus: 'accepted' },
    { email: 'jan.kowalski@example.test', responseStatus: 'declined' },
    { email: 'guest@example.com', responseStatus: 'accepted' },
  ];
  const r = match.matchByCalendar([], invitees, RATES, INDEX);
  assert.equal(r.total, 0);
  assert.equal(r.matched, 0);
  assert.equal(r.ratePerMinuteTotal, 0);
  assert.equal(r.presence, 'none');
});

test('matchByCalendar resolves a mangled display name to an invitee email', () => {
  // Meet shows "Zofia W" — too mangled for strict name matching, but among 2
  // invitees the localpart "zofia wojcik" is the clear nearest.
  const invitees = [
    { email: 'zofia.wojcik@example.test', responseStatus: 'accepted' },
    { email: 'ada.lovelace@example.test', responseStatus: 'accepted' },
  ];
  const r = match.matchByCalendar(['Zofia Wojcik'], invitees, RATES, INDEX);
  assert.equal(r.total, 1);
  assert.equal(r.matched, 1);
  assert.equal(r.details[0].matchType, 'email');
  assert.equal(r.details[0].rate, 1.5);
});

test('matchByCalendar falls back to name matching for a non-invitee', () => {
  const invitees = [{ email: 'ada.lovelace@example.test', responseStatus: 'accepted' }];
  const r = match.matchByCalendar(['Ada Lovelace', 'Jan Kowalski'], invitees, RATES, INDEX);
  assert.equal(r.matched, 2); // Ada via invitee email, Jan via name index
  assert.equal(Math.round(r.ratePerMinuteTotal * 100) / 100, 3.2);
});

test('an invitee is not claimed twice', () => {
  const invitees = [{ email: 'ada.lovelace@example.test', responseStatus: 'accepted' }];
  const r = match.matchByCalendar(['Ada Lovelace', 'Ada Lovelace'], invitees, RATES, INDEX);
  // Second "Ada" can't claim the same invitee — but still matches by name.
  assert.equal(r.matched, 2);
});

test('mock.rosterAt simulates joins and a temporary drop, deterministically', () => {
  assert.equal(mock.rosterAt(0).length, 3);
  assert.ok(mock.rosterAt(9).length > mock.rosterAt(0).length);
  assert.ok(!mock.rosterAt(13).includes('Dennis Ritchie')); // stepped out
  assert.ok(mock.rosterAt(17).includes('Dennis Ritchie')); // came back
  assert.equal(mock.rosterAt(60).length, mock.DEFAULT_ROSTER.length);
  assert.deepEqual(mock.rosterAt(5), mock.rosterAt(5));
});
