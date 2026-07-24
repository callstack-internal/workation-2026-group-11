// Escalating cost engine.
//
//   base            = sum of per-minute rates over everyone present (currency/min)
//   m(t)            = penalty multiplier, 1 until thresholdMin, then ramps up
//   currentRate/min = base * m(t)
//   total           = base * t * m(t)
//
// Pure module (no DOM/chrome) so it unit-tests in a Node VM.
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
    if (elapsedMin <= s.thresholdMin) return 1;
    return Math.min(s.maxMultiplier, 1 + s.alphaPerMin * (elapsedMin - s.thresholdMin));
  }

  function compute(baseRatePerMin, elapsedMin, settings) {
    const m = multiplier(elapsedMin, settings);
    return {
      multiplier: m,
      currentRatePerMin: baseRatePerMin * m,
      total: baseRatePerMin * Math.max(0, elapsedMin) * m,
    };
  }

  MCM.cost = { DEFAULTS, multiplier, compute };
})();
