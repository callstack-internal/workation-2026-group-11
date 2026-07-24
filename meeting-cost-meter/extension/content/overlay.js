// Aggregate-only floating overlay, rendered in a Shadow DOM so Meet's CSS can't
// touch it and ours can't leak out. Shows total cost, current rate/min, elapsed
// time, headcount, and an escalation badge. No per-person figures.
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MCM = (G.__MCM = G.__MCM || {});

  const STYLE = `
    :host { all: initial; }
    .card {
      position: fixed; top: 88px; right: 16px; z-index: 2147483647;
      width: 232px; font-family: 'Google Sans', Roboto, system-ui, sans-serif;
      color: #fff; background: #202124; border-radius: 12px; overflow: hidden;
      box-shadow: 0 6px 24px rgba(0,0,0,.4); user-select: none;
    }
    .bar { height: 6px; background: #34a853; transition: background .4s; }
    .bar.warn { background: #fbbc04; } .bar.alarm { background: #ea4335; }
    .head { display:flex; align-items:center; justify-content:space-between;
      padding: 8px 12px; cursor: move; background: #2d2e30; }
    .title { font-size: 12px; font-weight: 600; letter-spacing:.02em; opacity:.9; }
    .head button { all: unset; cursor: pointer; opacity:.7; padding:2px 6px; font-size:14px; }
    .head button:hover { opacity: 1; }
    .body { padding: 12px 14px 14px; }
    .total { font-size: 34px; font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; }
    .sub { display:flex; justify-content:space-between; font-size:12px; opacity:.75; margin-top: 8px; }
    .badge { margin-top: 10px; font-size: 12px; font-weight:600; padding: 5px 8px;
      border-radius: 6px; display:none; }
    .badge.show { display:block; }
    .badge.warn { background: rgba(251,188,4,.18); color:#fdd663; }
    .badge.alarm { background: rgba(234,67,53,.2); color:#f28b82; }
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
      border-radius:6px; border:1px solid #5f6368; background:#202124; color:#e8eaed; }
    .foot label { font-size: 10px; opacity:.6; display:block; margin-bottom:3px; }
    .hidden { display:none !important; }
  `;

  function fmtMoney(n, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);
    } catch {
      return `${Math.round(n || 0)} ${currency}`;
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

  function createOverlay({ currency = 'USD', onManualRoster, onConfirmOverride } = {}) {
    const host = document.createElement('div');
    host.id = 'mcm-overlay-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="card">
        <div class="bar"></div>
        <div class="head">
          <span class="title">💸 Meeting Cost <span class="mock-pill">MOCK</span></span>
          <button data-act="hide" title="Hide (Alt+Shift+C)">✕</button>
        </div>
        <div class="body">
          <div class="total">—</div>
          <div class="sub"><span class="rate"></span><span class="elapsed"></span></div>
          <div class="sub"><span class="people"></span><span class="mult"></span></div>
          <div class="badge"></div>
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
    const foot = $('.foot');
    const input = $('.foot input');
    const mockPill = $('.mock-pill');
    const unmatchedBox = $('.unmatched');
    const unmatchedList = $('.u-list');

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
    input.addEventListener('change', () => {
      const names = input.value.split(',').map((s) => s.trim()).filter(Boolean);
      onManualRoster?.(names);
    });
    makeDraggable(card, $('.head'));

    function update(state) {
      const { total, currentRatePerMin, multiplier, matched, totalPeople, elapsedMin, currency: cur } = state;
      const ccy = cur || currency;
      mockPill.classList.toggle('show', !!state.mock);
      renderUnmatched(state.unmatched);
      $('.total').textContent = fmtMoney(total, ccy);
      $('.rate').textContent = `${fmtMoney(currentRatePerMin, ccy)}/min`;
      $('.elapsed').textContent = fmtElapsed(elapsedMin);
      $('.people').textContent =
        totalPeople > 0 ? `${totalPeople} in call (${matched} matched)` : 'no one detected';
      $('.mult').textContent = multiplier > 1 ? `penalty ×${multiplier.toFixed(2)}` : '';

      const level = multiplier <= 1.01 ? 'ok' : multiplier < 2 ? 'warn' : 'alarm';
      bar.className = 'bar' + (level === 'warn' ? ' warn' : level === 'alarm' ? ' alarm' : '');
      badge.className = 'badge' + (level === 'warn' ? ' show warn' : level === 'alarm' ? ' show alarm' : '');
      if (level === 'warn') badge.textContent = '⏱ Running long — wrap it up.';
      else if (level === 'alarm') badge.textContent = '🔥 This is getting expensive. End the call!';

      // Show the manual-roster input only when we detect nobody.
      foot.classList.toggle('hidden', totalPeople > 0);
    }

    let visible = true;
    function setVisible(v) {
      visible = v;
      card.classList.toggle('hidden', !v);
    }
    function toggle() {
      setVisible(!visible);
    }
    function destroy() {
      host.remove();
    }

    return { update, setVisible, toggle, destroy };
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
