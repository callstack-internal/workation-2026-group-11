// Name normalization shared by the ingest step.
//
// IMPORTANT: the algorithm here MUST stay in sync with `normalizeName` /
// `tokenKey` in `extension/content/match.js`. The ingest step bakes the keys,
// the extension normalizes live Meet display names and looks them up — if the
// two implementations drift, matching silently breaks.

/** Lowercase, strip diacritics (incl. Polish ł/ż/ś…), drop parentheticals & punctuation. */
export function normalizeName(input) {
  return String(input || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .replace(/ø/g, 'o')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // "(You)", "(guest)", "(Callstack)"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(name) {
  return normalizeName(name).split(' ').filter(Boolean);
}

/** Order-independent key so "First Last" and "Last First" collide. */
export function tokenKey(name) {
  return tokenize(name).slice().sort().join(' ');
}

/** Build the set of lookup keys for one employee record. */
export function buildKeys({ firstName, lastName, title, aliases, email }) {
  const keys = new Set();
  const add = (s) => {
    const n = normalizeName(s);
    if (!n) return;
    keys.add(n);
    keys.add(tokenKey(n));
  };
  if (firstName && lastName) add(`${firstName} ${lastName}`);
  if (title) add(title); // stored "Surname Name"
  for (const a of aliases || []) add(a);
  if (email) {
    keys.add(email.trim().toLowerCase()); // full email — exact key for Calendar-API matching
    add(email.split('@')[0].replace(/[._-]+/g, ' ')); // localpart as a name fallback
  }
  return [...keys].filter(Boolean);
}
