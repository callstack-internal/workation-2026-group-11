// PLN/USD conversion helpers. NBP publishes PLN per 1 USD, so PLN -> USD is
// division and USD -> PLN is multiplication. No guessed fallback is used:
// conversion stays unavailable until a real NBP quote (or cached quote) exists.
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MCM = (G.__MCM = G.__MCM || {});

  function normalizeCurrency(value) {
    const code = String(value || '').trim().toUpperCase();
    return code === 'USD' ? 'USD' : code === 'PLN' ? 'PLN' : code;
  }

  function convert(amount, fromCurrency, toCurrency, plnPerUsd) {
    const value = Number(amount);
    const from = normalizeCurrency(fromCurrency);
    const to = normalizeCurrency(toCurrency);
    if (!Number.isFinite(value)) return null;
    if (from === to) return value;
    const rate = Number(plnPerUsd);
    if (!(rate > 0)) return null;
    if (from === 'PLN' && to === 'USD') return value / rate;
    if (from === 'USD' && to === 'PLN') return value * rate;
    return null;
  }

  MCM.currency = { normalizeCurrency, convert };
})();
