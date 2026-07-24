// Escalating, cumulative cost engine.
//
// The ledger integrates each roster's rate only over the time that roster was
// active. Joining or leaving therefore changes future accrual without
// recalculating earlier minutes at the new rate.
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MCM = (G.__MCM = G.__MCM || {});

  const DEFAULTS = {
    thresholdMin: 30, // grace period before the penalty starts
    alphaPerMin: 0.05, // multiplier growth per minute past the threshold
    maxMultiplier: 4, // cap
  };

  function multiplier(elapsedMin, settings) {
    const s = { ...DEFAULTS, ...(settings || {}) };
    const elapsed = Math.max(0, Number(elapsedMin) || 0);
    const threshold = Math.max(0, Number(s.thresholdMin) || 0);
    const alpha = Math.max(0, Number(s.alphaPerMin) || 0);
    const cap = Math.max(1, Number(s.maxMultiplier) || 1);
    if (elapsed <= threshold) return 1;
    return Math.min(cap, 1 + alpha * (elapsed - threshold));
  }

  // Exact integral of multiplier(t) between two elapsed-minute values.
  function integrateMultiplier(fromMin, toMin, settings) {
    const start = Math.max(0, Number(fromMin) || 0);
    const end = Math.max(start, Number(toMin) || 0);
    if (end === start) return 0;

    const s = { ...DEFAULTS, ...(settings || {}) };
    const threshold = Math.max(0, Number(s.thresholdMin) || 0);
    const alpha = Math.max(0, Number(s.alphaPerMin) || 0);
    const cap = Math.max(1, Number(s.maxMultiplier) || 1);
    if (alpha === 0 || cap === 1) return end - start;

    const capAt = threshold + (cap - 1) / alpha;
    let area = 0;
    let cursor = start;

    if (cursor < threshold) {
      const stop = Math.min(end, threshold);
      area += stop - cursor;
      cursor = stop;
    }
    if (cursor < end && cursor < capAt) {
      const stop = Math.min(end, capAt);
      const x0 = cursor - threshold;
      const x1 = stop - threshold;
      area += stop - cursor + (alpha * (x1 * x1 - x0 * x0)) / 2;
      cursor = stop;
    }
    if (cursor < end) area += (end - cursor) * cap;
    return area;
  }

  // Kept as a stateless projection for callers that need a single fixed-rate
  // interval. Live meetings use createLedger().
  function compute(baseRatePerMin, elapsedMin, settings) {
    const elapsed = Math.max(0, Number(elapsedMin) || 0);
    const base = Math.max(0, Number(baseRatePerMin) || 0);
    const m = multiplier(elapsed, settings);
    return {
      multiplier: m,
      currentRatePerMin: base * m,
      total: base * integrateMultiplier(0, elapsed, settings),
    };
  }

  function createLedger(saved) {
    const initial = saved && typeof saved === 'object' ? saved : {};
    let started = initial.started === true;
    let elapsedMin = nonNegative(initial.elapsedMin);
    let total = nonNegative(initial.total);
    let activeRatePerMin = nonNegative(initial.activeRatePerMin);
    let lastTsMs = Number.isFinite(Number(initial.lastTsMs)) ? Number(initial.lastTsMs) : null;

    function update({ nowMs = Date.now(), ratePerMinute = 0, hasPresence = false, settings } = {}) {
      const now = Number(nowMs);
      if (!Number.isFinite(now)) throw new TypeError('nowMs must be a finite number');
      const nextRate = hasPresence ? nonNegative(ratePerMinute) : 0;

      if (!started) {
        if (!hasPresence) return view(settings);
        started = true;
        lastTsMs = now;
        activeRatePerMin = nextRate;
        return view(settings);
      }

      const deltaMin = lastTsMs == null ? 0 : Math.max(0, now - lastTsMs) / 60000;
      if (deltaMin > 0) {
        total += activeRatePerMin * integrateMultiplier(elapsedMin, elapsedMin + deltaMin, settings);
        elapsedMin += deltaMin;
      }
      lastTsMs = now;
      activeRatePerMin = nextRate;
      return view(settings);
    }

    function view(settings) {
      const m = multiplier(elapsedMin, settings);
      return {
        started,
        elapsedMin,
        total,
        multiplier: m,
        currentRatePerMin: activeRatePerMin * m,
        baseRatePerMin: activeRatePerMin,
      };
    }

    function snapshot() {
      return { version: 1, started, elapsedMin, total, activeRatePerMin, lastTsMs };
    }

    // Resume after an intentional pause (for example, Meet's post-call screen)
    // without adding the paused wall-clock gap to meeting elapsed time.
    function rebase(nowMs = Date.now(), settings) {
      const now = Number(nowMs);
      if (!Number.isFinite(now)) throw new TypeError('nowMs must be a finite number');
      if (started) lastTsMs = now;
      return view(settings);
    }

    return { update, view, snapshot, rebase };
  }

  function nonNegative(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  MCM.cost = { DEFAULTS, multiplier, integrateMultiplier, compute, createLedger };
})();
