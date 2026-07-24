// Shared mock roster used by (a) mock mode inside a real Meet and (b) the
// standalone demo page. Names line up with extension/data/rates.mock.json so
// most of them "match"; "External Guest" is intentionally unmatched to show the
// average-rate fallback.
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MCM = (G.__MCM = G.__MCM || {});

  const DEFAULT_ROSTER = [
    'Ada Lovelace',
    'Alan Turing',
    'Grace Hopper',
    'Katherine Johnson',
    'Dennis Ritchie',
    'Barbara Liskov',
    'External Guest',
  ];

  // Full-mock-mode churn: [joinsAtMin, leavesAtMin?] per roster slot, so the
  // simulated meeting has people trickling in, a guest arriving late, and
  // someone stepping out — all deterministic in elapsed time.
  const SCHEDULE = [
    { joins: 0 },
    { joins: 0 },
    { joins: 0 },
    { joins: 2 },
    { joins: 4, leaves: 12, rejoins: 16 },
    { joins: 6 },
    { joins: 8 }, // External Guest — unmatched, shows the average-rate fallback
  ];

  /** Simulated participant list after `elapsedMin` minutes of mock meeting. */
  function rosterAt(elapsedMin) {
    const t = Math.max(0, Number(elapsedMin) || 0);
    const out = [];
    DEFAULT_ROSTER.forEach((name, i) => {
      const s = SCHEDULE[i] || { joins: 0 };
      if (t < s.joins) return;
      if (s.leaves != null && t >= s.leaves && (s.rejoins == null || t < s.rejoins)) return;
      out.push(name);
    });
    return out;
  }

  MCM.mock = { DEFAULT_ROSTER, rosterAt };
})();
