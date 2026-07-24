(function () {
  const MCM = window.__MCM;
  const thresholds = { ...MCM.settings.ALERT_THRESHOLDS_USD };
  const plnPerUsd = 4;
  let totalUsd = 0;
  let displayCurrency = 'USD';
  let mode = 'normal';

  const overlay = MCM.overlay.createOverlay({
    currency: displayCurrency,
    onCurrencyChange: (currency) => {
      displayCurrency = currency;
      render();
    },
  });

  function render() {
    const total = MCM.currency.convert(totalUsd, 'USD', displayCurrency, plnPerUsd);
    const rate = MCM.currency.convert(
      mode === 'waiting' ? 0 : 2,
      'USD',
      displayCurrency,
      plnPerUsd,
    );
    overlay.update({
      total,
      currentRatePerMin: rate,
      multiplier: mode === 'waiting' ? 1 : 1.25,
      matched: 3,
      totalPeople: mode === 'waiting' ? 0 : 4,
      elapsedMin: 12.5,
      currency: displayCurrency,
      mock: false,
      unmatched: [],
      alertLevel: MCM.settings.alertLevel(totalUsd, thresholds),
      alertThresholdsUsd: thresholds,
      ratesAvailable: true,
      started: mode !== 'waiting',
      estimated: mode === 'estimate' ? 1 : 0,
      fallback: 0,
      unknown: mode === 'estimate' ? 1 : 0,
    });
  }

  for (const button of document.querySelectorAll('[data-total]')) {
    button.addEventListener('click', () => {
      totalUsd = Number(button.dataset.total);
      mode = 'normal';
      render();
    });
  }
  document.getElementById('estimate').addEventListener('click', () => {
    mode = 'estimate';
    render();
  });
  document.getElementById('waiting').addEventListener('click', () => {
    totalUsd = 0;
    mode = 'waiting';
    render();
  });

  render();
})();
