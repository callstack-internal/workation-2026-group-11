// Aggregate-only floating overlay rendered in a Shadow DOM. The whole card
// follows the USD alert thresholds; red blinks. No per-person rates are shown.
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MCM = (G.__MCM = G.__MCM || {});

  const STYLE = `
    :host { all: initial; }
    .card {
      position: fixed; top: 88px; right: 16px; z-index: 2147483647;
      width: 248px; font-family: 'Google Sans', Roboto, system-ui, sans-serif;
      color: #fff; background: #188038; border-radius: 12px; overflow: hidden;
      box-shadow: 0 6px 24px rgba(0,0,0,.4); user-select: none;
      transition: background .35s, color .35s;
    }
    .card.green { background:#188038; }
    .card.yellow { background:#f9ab00; color:#202124; }
    .card.orange { background:#e8710a; color:#fff; }
    .card.red { background:#d93025; color:#fff; animation:mcm-alarm-blink 1s steps(2,end) infinite; }
    .card.red.ended { animation:none; filter:none; box-shadow:0 6px 24px rgba(217,48,37,.55); }
    .card.unavailable { background:#5f6368; color:#fff; }
    @keyframes mcm-alarm-blink {
      0%, 49% { filter:brightness(1); box-shadow:0 6px 24px rgba(217,48,37,.8); }
      50%, 100% { filter:brightness(.62); box-shadow:0 6px 24px rgba(0,0,0,.25); }
    }
    .bar { height: 6px; background: rgba(255,255,255,.45); }
    .head { display:flex; align-items:center; justify-content:space-between;
      padding: 8px 10px 8px 12px; cursor: move; background: rgba(0,0,0,.18); }
    .title { font-size: 12px; font-weight: 600; letter-spacing:.02em; opacity:.9; }
    .actions { display:flex; align-items:center; gap:2px; }
    .head button { all: unset; cursor: pointer; opacity:.8; padding:2px 6px; font-size:14px; }
    .head button:hover { opacity: 1; }
    .head .currency { font-size:10px; font-weight:700; border:1px solid currentColor;
      border-radius:5px; padding:2px 5px; }
    .body { padding: 12px 14px 14px; }
    .total { font-size: 34px; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; }
    .sub { display:flex; justify-content:space-between; font-size:12px; opacity:.75; margin-top: 8px; }
    .badge { margin-top: 10px; font-size: 12px; font-weight:600; padding: 5px 8px;
      border-radius: 6px; display:none; }
    .badge.show { display:block; }
    .badge { background:rgba(0,0,0,.18); color:inherit; }
    .notice { margin-top:10px; font-size:11px; line-height:1.35; padding:6px 8px;
      border-radius:6px; background:rgba(0,0,0,.16); display:none; }
    .notice.show { display:block; }
    .mock-pill { font-size: 10px; font-weight: 700; letter-spacing:.06em; padding: 2px 6px;
      border-radius: 4px; background: rgba(138,180,248,.25); color:#8ab4f8; display:none; }
    .mock-pill.show { display:inline-block; }
    .unmatched { margin-top: 10px; display:none; }
    .unmatched.show { display:block; }
    .unmatched .u-title { font-size: 10px; opacity:.6; margin-bottom: 4px; }
    .u-row { display:flex; align-items:center; gap:6px; font-size:11px; margin: 3px 0; flex-wrap: wrap; }
    .u-name { opacity:.85; }
    .u-chip { all: unset; cursor:pointer; font-size:11px; padding: 2px 8px; border-radius: 10px;
      background: rgba(138,180,248,.15); color:#8ab4f8; border: 1px solid rgba(138,180,248,.4); }
    .u-chip:hover { background: rgba(138,180,248,.3); }
    .foot { margin-top:10px; }
    .foot input { width: 100%; box-sizing: border-box; font-size: 11px; padding:5px 6px;
      border-radius:6px; border:1px solid currentColor; background:rgba(0,0,0,.22); color:inherit; }
    .foot input::placeholder { color:currentColor; opacity:.65; }
    .foot label { font-size: 10px; opacity:.6; display:block; margin-bottom:3px; }
    .hidden { display:none !important; }
  `;

  function fmtMoney(n, currency) {
    if (!Number.isFinite(n)) return '—';
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency}`;
    }
  }

  function fmtElapsed(min) {
    const s = Math.max(0, Math.floor(min * 60));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (x) => String(x).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  function createOverlay({
    currency = 'PLN',
    onManualRoster,
    onConfirmOverride,
    onCurrencyChange,
  } = {}) {
    const host = document.createElement('div');
    host.id = 'mcm-overlay-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="card">
        <div class="bar"></div>
        <div class="head">
          <span class="title">💸 Meeting Cost <span class="mock-pill">MOCK</span></span>
          <span class="actions">
            <button class="currency" data-act="currency" title="Switch PLN / USD">${currency}</button>
            <button data-act="hide" title="Hide (Alt+Shift+C)">✕</button>
          </span>
        </div>
        <div class="body">
          <div class="total">—</div>
          <div class="sub"><span class="rate"></span><span class="elapsed"></span></div>
          <div class="sub"><span class="people"></span><span class="mult"></span></div>
          <div class="badge"></div>
          <div class="notice"></div>
          <div class="unmatched"><div class="u-title">Not recognized — click to fix:</div><div class="u-list"></div></div>
          <div class="foot hidden">
            <label>Names not detected? Enter them, comma-separated:</label>
            <input type="text" placeholder="Ada Lovelace, Alan Turing" />
          </div>
        </div>
      </div>`;
    (document.body || document.documentElement).appendChild(host);

    const $ = (sel) => root.querySelector(sel);
    const card = $('.card');
    const bar = $('.bar');
    const badge = $('.badge');
    const notice = $('.notice');
    const foot = $('.foot');
    const input = $('.foot input');
    const mockPill = $('.mock-pill');
    const unmatchedBox = $('.unmatched');
    const unmatchedList = $('.u-list');
    const currencyButton = $('[data-act="currency"]');
    let selectedCurrency = currency === 'USD' ? 'USD' : 'PLN';

    // "First Last" for a normalized suggestion key, for display only.
    const titleCase = (key) =>
      String(key).split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

    function renderUnmatched(entries) {
      // entries: [{ name, suggestions: [{ key }] }] — only rendered when the
      // orchestrator can persist a fix (onConfirmOverride present).
      const list = onConfirmOverride ? (entries || []).slice(0, 4) : [];
      unmatchedBox.classList.toggle('show', list.length > 0);
      unmatchedList.textContent = '';
      for (const e of list) {
        const row = document.createElement('div');
        row.className = 'u-row';
        const nameEl = document.createElement('span');
        nameEl.className = 'u-name';
        nameEl.textContent = `❓ ${e.name}`;
        row.appendChild(nameEl);
        for (const s of (e.suggestions || []).slice(0, 2)) {
          const chip = document.createElement('button');
          chip.className = 'u-chip';
          chip.textContent = `${titleCase(s.key)}?`;
          chip.title = 'Remember this match for future meetings';
          chip.addEventListener('click', () => onConfirmOverride(e.name, s.key));
          row.appendChild(chip);
        }
        unmatchedList.appendChild(row);
      }
    }

    $('[data-act="hide"]').addEventListener('click', () => setVisible(false));
    currencyButton.addEventListener('click', () => {
      selectedCurrency = selectedCurrency === 'PLN' ? 'USD' : 'PLN';
      currencyButton.textContent = selectedCurrency;
      onCurrencyChange?.(selectedCurrency);
    });
    input.addEventListener('change', () => {
      const names = input.value.split(',').map((s) => s.trim()).filter(Boolean);
      onManualRoster?.(names);
    });
    makeDraggable(card, $('.head'));

    function update(state) {
      const {
        total,
        currentRatePerMin,
        multiplier,
        matched,
        totalPeople,
        elapsedMin,
        currency: cur,
      } = state;
      const ccy = cur || selectedCurrency;
      selectedCurrency = ccy;
      currencyButton.textContent = selectedCurrency;
      mockPill.classList.toggle('show', !!state.mock);
      renderUnmatched(state.unmatched);
      $('.total').textContent = fmtMoney(total, ccy);
      $('.rate').textContent = `${fmtMoney(currentRatePerMin, ccy)}/min`;
      $('.elapsed').textContent = fmtElapsed(elapsedMin);
      $('.people').textContent = state.ended
        ? 'meeting ended'
        : totalPeople > 0
          ? `${totalPeople} in call (${matched} rated)`
          : 'waiting for attendees';
      $('.mult').textContent = multiplier > 1 ? `penalty ×${multiplier.toFixed(2)}` : '';

      const level = ['green', 'yellow', 'orange', 'red'].includes(state.alertLevel)
        ? state.alertLevel
        : 'unavailable';
      card.classList.remove('green', 'yellow', 'orange', 'red', 'unavailable');
      card.classList.add(level);
      card.classList.toggle('ended', !!state.ended);

      const thresholds = state.alertThresholdsUsd || {};
      badge.className = 'badge';
      if (level === 'yellow') {
        badge.classList.add('show');
        badge.textContent = `⚠ Cost passed $${thresholds.yellow ?? 10}.`;
      } else if (level === 'orange') {
        badge.classList.add('show');
        badge.textContent = `⏱ Cost passed $${thresholds.orange ?? 20} — wrap up.`;
      } else if (level === 'red') {
        badge.classList.add('show');
        badge.textContent = `🔥 Cost passed $${thresholds.red ?? 30} — end the call.`;
      }

      const messages = [];
      if (state.availabilityMessage) messages.push(state.availabilityMessage);
      if (!state.started && !state.availabilityMessage) {
        messages.push('The meter starts when a real participant roster is detected.');
      }
      if (state.unknown > 0) {
        messages.push(
          `Partial estimate: ${state.unknown} attendee ${state.unknown === 1 ? 'rate is' : 'rates are'} unavailable and excluded.`,
        );
      }
      const assumed = Math.max(0, (state.estimated || 0) - (state.fallback || 0));
      if (assumed > 0) {
        messages.push(
          `Estimate: ${assumed} ${assumed === 1 ? 'rate uses' : 'rates use'} the configured contract-type assumption.`,
        );
      }
      if (state.fallback > 0) {
        messages.push(
          `Estimate: ${state.fallback} ${state.fallback === 1 ? 'attendee uses' : 'attendees use'} the explicit company fallback.`,
        );
      }
      notice.textContent = messages.join(' ');
      notice.classList.toggle('show', messages.length > 0);

      // Show the manual-roster input only when we detect nobody.
      foot.classList.toggle('hidden', totalPeople > 0 || state.ratesAvailable === false);
    }

    let visible = true;
    let active = true;
    function applyVisibility() {
      card.classList.toggle('hidden', !visible || !active);
    }
    function setVisible(v) {
      visible = v;
      applyVisibility();
    }
    function setActive(v) {
      active = v;
      applyVisibility();
    }
    function toggle() {
      setVisible(!visible);
    }
    function destroy() {
      host.remove();
    }

    return { update, setVisible, setActive, toggle, destroy };
  }

  function makeDraggable(card, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      const r = card.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      card.style.left = ox + (e.clientX - sx) + 'px';
      card.style.top = oy + (e.clientY - sy) + 'px';
      card.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  MCM.overlay = { createOverlay };
})();
