// Match live Meet display names (or Calendar emails) to baked per-minute rates.
//
// normalizeName / tokenKey MUST stay identical to ingest/normalize.js.
// Written as an IIFE on a global `__MCM` namespace so it works as a content
// script AND can be loaded in a Node VM for unit tests.
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MCM = (G.__MCM = G.__MCM || {});

  function normalizeName(input) {
    return String(input || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'l')
      .replace(/ø/g, 'o')
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenKey(name) {
    return normalizeName(name).split(' ').filter(Boolean).sort().join(' ');
  }

  function buildIndex(rates) {
    const map = new Map();
    for (const person of rates.people || []) {
      for (const key of person.keys || []) {
        if (!map.has(key)) map.set(key, person.ratePerMinute);
      }
    }
    return map;
  }

  // --- fuzzy fallback (Levenshtein similarity) ---
  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const row = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return row[n];
  }

  function similarity(a, b) {
    const max = Math.max(a.length, b.length);
    return max ? 1 - levenshtein(a, b) / max : 1;
  }

  // Nearest name-type key (skips emails) above a confidence threshold.
  function nearestKey(target, keys, threshold) {
    if (target.length < 5) return null; // too short to fuzzy-match safely
    let best = null;
    let bestSim = threshold;
    for (const key of keys) {
      if (key.includes('@')) continue;
      const sim = similarity(target, key);
      if (sim >= bestSim) {
        bestSim = sim;
        best = key;
      }
    }
    return best;
  }

  /**
   * @param opts { overrides?: {normalizedDisplayName: canonicalName}, fuzzyThreshold?, keys?: string[] }
   * @returns { matched, total, ratePerMinuteTotal, details: [{name, rate, isMatch, matchType}] }
   */
  function matchParticipants(names, rates, index, opts = {}) {
    const overrides = opts.overrides || {};
    const fuzzyThreshold = opts.fuzzyThreshold ?? 0.86;
    const keys = opts.keys || [...index.keys()];

    let ratePerMinuteTotal = 0;
    let matched = 0;
    const details = [];

    for (const name of names) {
      const normDisplay = normalizeName(name);
      const lookupName = overrides[normDisplay] || name; // remembered manual fix
      const normLookup = normalizeName(lookupName);

      let rate = null;
      let matchType = 'none';
      for (const c of [normLookup, tokenKey(lookupName)]) {
        if (index.has(c)) {
          rate = index.get(c);
          matchType = overrides[normDisplay] ? 'override' : 'exact';
          break;
        }
      }
      if (rate == null) {
        const near = nearestKey(normLookup, keys, fuzzyThreshold);
        if (near != null) {
          rate = index.get(near);
          matchType = 'fuzzy';
        }
      }

      const isMatch = matchType !== 'none';
      if (!isMatch) rate = rates.defaultRatePerMinute || 0;
      if (isMatch) matched++;
      ratePerMinuteTotal += rate;
      details.push({ name, rate, isMatch, matchType });
    }
    return { matched, total: names.length, ratePerMinuteTotal, details };
  }

  /** Exact match by email address (Calendar-API path). */
  function rateForEmail(email, rates, index) {
    const rate = index.get(String(email || '').trim().toLowerCase());
    return rate != null ? { rate, isMatch: true } : { rate: rates.defaultRatePerMinute || 0, isMatch: false };
  }

  /**
   * "Did you mean …?" candidates for an unmatched display name: nearest
   * name-type keys BELOW the auto-accept threshold but above `floor`.
   * Deduped per person (via token order) and best-first: [{ key, sim }].
   */
  function suggestFor(name, keys, opts = {}) {
    const { floor = 0.5, ceiling = 1.01, limit = 3 } = opts;
    const target = tokenKey(name);
    if (target.length < 3) return [];
    const scored = [];
    for (const key of keys) {
      if (key.includes('@')) continue;
      const sim = Math.max(similarity(normalizeName(name), key), similarity(target, tokenKey(key)));
      if (sim >= floor && sim < ceiling) scored.push({ key, sim });
    }
    scored.sort((a, b) => b.sim - a.sim);
    const seen = new Set();
    const out = [];
    for (const s of scored) {
      const person = tokenKey(s.key);
      if (seen.has(person)) continue;
      seen.add(person);
      out.push(s);
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * Calendar-first matching: invitees [{email, displayName?, responseStatus?}]
   * carry identity + rate (exact email keys); scraped display names carry
   * presence only. With no scraped names, every non-declined invitee is
   * charged. Names that resolve to no invitee fall back to name matching.
   */
  function matchByCalendar(names, invitees, rates, index, opts = {}) {
    const presenceThreshold = opts.presenceThreshold ?? 0.6;
    const pool = (invitees || [])
      .filter((i) => i && i.email && i.responseStatus !== 'declined')
      .map((i) => {
        const localpartName = String(i.email).split('@')[0].replace(/[._-]+/g, ' ');
        const nameKeys = [i.displayName, localpartName].filter(Boolean).map(tokenKey).filter(Boolean);
        return { email: String(i.email).trim().toLowerCase(), label: i.displayName || localpartName, nameKeys, claimed: false };
      });

    // No presence info — charge the whole invite list.
    if (!names || !names.length) {
      let ratePerMinuteTotal = 0;
      let matched = 0;
      const details = [];
      for (const inv of pool) {
        const r = rateForEmail(inv.email, rates, index);
        if (r.isMatch) matched++;
        ratePerMinuteTotal += r.rate;
        details.push({ name: inv.label, rate: r.rate, isMatch: r.isMatch, matchType: r.isMatch ? 'email' : 'none' });
      }
      return { matched, total: pool.length, ratePerMinuteTotal, details, presence: 'invitees' };
    }

    // Presence known: resolve each scraped name to an invitee. The candidate
    // set is tiny (this meeting's invitees), so a lower threshold is safe.
    let ratePerMinuteTotal = 0;
    let matched = 0;
    const details = [];
    for (const name of names) {
      const target = tokenKey(opts.overrides?.[normalizeName(name)] || name);
      let best = null;
      let bestSim = presenceThreshold;
      for (const inv of pool) {
        if (inv.claimed) continue;
        for (const k of inv.nameKeys) {
          const sim = similarity(target, k);
          if (sim >= bestSim) {
            bestSim = sim;
            best = inv;
          }
        }
      }
      if (best) {
        best.claimed = true;
        const r = rateForEmail(best.email, rates, index);
        if (r.isMatch) matched++;
        ratePerMinuteTotal += r.rate;
        details.push({ name, rate: r.rate, isMatch: r.isMatch, matchType: r.isMatch ? 'email' : 'none' });
      } else {
        const m = matchParticipants([name], rates, index, opts);
        if (m.details[0].isMatch) matched++;
        ratePerMinuteTotal += m.details[0].rate;
        details.push(m.details[0]);
      }
    }
    return { matched, total: names.length, ratePerMinuteTotal, details, presence: 'scraped' };
  }

  MCM.match = { normalizeName, tokenKey, buildIndex, matchParticipants, rateForEmail, suggestFor, matchByCalendar, similarity };
})();
