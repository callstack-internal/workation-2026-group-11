// Scrape participant display names from the Google Meet DOM.
//
// ⚠ This is the fragile part: Meet's markup is obfuscated and changes often, so
// we try several strategies and fail soft. If auto-detection returns nothing,
// real mode bills nobody and offers a manual roster; mock data is explicit-only.
// Use `window.__MCM.scrape.debugDump()` in the console to discover new selectors.
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MCM = (G.__MCM = G.__MCM || {});

  // Real Meet calls use a three-four-three letter code in the path. Landing,
  // lookup, new-call, and settings routes are not meetings and must never
  // activate the overlay or its ledger.
  const MEETING_PATH_RE = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/i;

  function meetingCodeFromPath(pathname) {
    return String(pathname || '').match(MEETING_PATH_RE)?.[1]?.toLowerCase() || null;
  }

  function isMeetingPath(pathname) {
    return meetingCodeFromPath(pathname) != null;
  }

  const MEETING_ENDED_RE =
    /^(?:you(?: have|['’]ve)? left (?:the )?(?:meeting|call)|(?:this |the )?(?:meeting|call) (?:has )?ended)$/i;

  function isMeetingEndedText(text) {
    return MEETING_ENDED_RE.test(String(text || '').replace(/\s+/g, ' ').trim());
  }

  function hasPostMeetingControls(labels) {
    const normalized = (labels || []).map((label) =>
      String(label || '').replace(/\s+/g, ' ').trim().toLowerCase(),
    );
    return (
      normalized.some((label) => label === 'rejoin') &&
      normalized.some((label) => label === 'return to home screen')
    );
  }

  function isMeetingEnded() {
    if (typeof G.__MCM_FORCE_MEETING_ENDED === 'boolean') {
      return G.__MCM_FORCE_MEETING_ENDED;
    }
    if (typeof document === 'undefined') return false;
    const headings = document.querySelectorAll('h1, h2, h3, [role="heading"]');
    for (const heading of headings) {
      if (isMeetingEndedText(heading.textContent)) return true;
    }
    const buttonLabels = [...document.querySelectorAll('button, [role="button"]')].map(
      (button) => button.getAttribute('aria-label') || button.textContent,
    );
    return hasPostMeetingControls(buttonLabels);
  }

  // Strings that show up in tiles/roster but are not people.
  const NOT_A_NAME = /^(you|presenting|pinned|more options|mute|remove|meeting details|in this call|contributors|\d+)$/i;

  function looksLikeName(s) {
    if (!s) return false;
    const t = s.trim();
    if (t.length < 2 || t.length > 60) return false;
    if (NOT_A_NAME.test(t)) return false;
    if (/[@/]/.test(t)) return false; // emails / handles / paths
    return /[a-zA-Zà-ÿĀ-ž]/.test(t);
  }

  function cleanName(s) {
    return String(s || '')
      .replace(/\(.*?\)/g, '') // "(You)", "(Guest)"
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Strategy 1 — roster panel / tiles that expose a participant id.
  function fromParticipantNodes() {
    const names = new Set();
    const nodes = document.querySelectorAll('[data-participant-id], [data-self-name]');
    for (const el of nodes) {
      let candidate = el.getAttribute('data-self-name') || '';
      if (!candidate) {
        // Prefer an aria-label, else the shortest sensible text node inside.
        candidate = el.getAttribute('aria-label') || '';
      }
      if (!candidate) {
        const texts = [...el.querySelectorAll('span, div')]
          .map((n) => n.childNodes.length === 1 && n.firstChild?.nodeType === 3 ? n.textContent : '')
          .map(cleanName)
          .filter(looksLikeName);
        candidate = texts.sort((a, b) => a.length - b.length)[0] || '';
      }
      const name = cleanName(candidate);
      if (looksLikeName(name)) names.add(name);
    }
    return [...names];
  }

  // Strategy 2 — the People panel list, addressed by its heading/aria region.
  function fromRosterPanel() {
    const names = new Set();
    const panel =
      document.querySelector('[aria-label="Participants" i]') ||
      document.querySelector('[aria-label="People" i]') ||
      document.querySelector('div[role="list"]');
    if (!panel) return [];
    for (const item of panel.querySelectorAll('[role="listitem"], li')) {
      const name = cleanName(item.getAttribute('aria-label') || item.textContent);
      if (looksLikeName(name)) names.add(name);
    }
    return [...names];
  }

  // Strategy 0 — a user-supplied CSS selector (Options), for when Meet's markup
  // changes and the built-in strategies miss. Editing config beats rebuilding.
  let customSelector = null;
  function setCustomSelector(sel) {
    customSelector = sel && String(sel).trim() ? String(sel).trim() : null;
  }
  function fromCustomSelector() {
    if (!customSelector) return [];
    try {
      const names = new Set();
      for (const el of document.querySelectorAll(customSelector)) {
        const name = cleanName(el.getAttribute('aria-label') || el.textContent);
        if (looksLikeName(name)) names.add(name);
      }
      return [...names];
    } catch (_) {
      return []; // invalid selector — ignore
    }
  }

  let manualRoster = null; // string[] | null — set from the overlay
  function setManualRoster(names) {
    manualRoster = Array.isArray(names) && names.length ? names.map(cleanName).filter(Boolean) : null;
  }

  let warnedEmpty = false;
  function getParticipants() {
    if (Array.isArray(G.__MCM_FORCE_NAMES)) return dedupe(G.__MCM_FORCE_NAMES); // test hook
    if (manualRoster) return dedupe(manualRoster);
    // Roster panel (aria labels) is more stable than obfuscated tile classes, so try it first.
    const result = firstNonEmpty(fromCustomSelector(), fromRosterPanel(), fromParticipantNodes());
    if (!result.length && !warnedEmpty) {
      warnedEmpty = true;
      console.warn('[MCM] scraped 0 participants — Meet markup may have changed. Try window.__MCM.scrape.debugDump(), a custom selector in Options, or the manual box.');
    } else if (result.length) {
      warnedEmpty = false;
    }
    return dedupe(result);
  }

  function firstNonEmpty(...lists) {
    for (const l of lists) if (l && l.length) return l;
    return [];
  }

  function dedupe(arr) {
    const seen = new Set();
    const out = [];
    for (const n of arr) {
      const key = n.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(n);
      }
    }
    return out;
  }

  /** Call cb whenever the participant set may have changed (debounced). */
  function onChange(cb) {
    let timer = null;
    const fire = () => {
      clearTimeout(timer);
      timer = setTimeout(cb, 400);
    };
    const observer = new MutationObserver(fire);
    observer.observe(document.body, { childList: true, subtree: true });
    // Belt-and-braces: also poll, since some Meet updates don't mutate the DOM.
    const poll = setInterval(cb, 5000);
    return () => {
      observer.disconnect();
      clearInterval(poll);
    };
  }

  function debugDump() {
    console.group('[MCM] participant scrape debug');
    console.log('fromParticipantNodes:', fromParticipantNodes());
    console.log('fromRosterPanel:', fromRosterPanel());
    console.log('[data-participant-id] count:', document.querySelectorAll('[data-participant-id]').length);
    console.groupEnd();
  }

  MCM.scrape = {
    getParticipants,
    onChange,
    setManualRoster,
    setCustomSelector,
    debugDump,
    looksLikeName,
    cleanName,
    meetingCodeFromPath,
    isMeetingPath,
    isMeetingEndedText,
    hasPostMeetingControls,
    isMeetingEnded,
  };
})();
