// Combine employees + parsed salary bands into the minimal rates.json the
// extension ships. Only normalized name/email keys and a rounded per-minute
// rate leave this step — no names, levels, or raw salaries.
//
// Real "Delivery" PDF has two keying schemes and two contract types:
//   - Developers: keyed by LEVEL (Expert / Senior 2 / … / Mid 1)
//   - QA & Portfolio: keyed by full role TITLE
//   - each exists as (B2B) and (CoE); the employee DB has no contract-type
//     field, so config.contractType picks one (or "average").

import { buildKeys } from './normalize.js';

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const toTokens = (s) => norm(s).split(' ').filter(Boolean);

export function isLevel(tag, levelTokens) {
  return levelTokens.some((t) => norm(t) === norm(tag));
}

function categoryFor(roles) {
  const text = roles.join(' ').toLowerCase();
  if (/qa|quality/.test(text)) return 'qa';
  if (/analyst|product owner|project manager|scrum|delivery manager|portfolio|coordinator|\bpm\b|\bpo\b/.test(text)) return 'portfolio';
  if (/dev|developer|engineer|programmer|architect/.test(text)) return 'developers';
  return 'other';
}

function sectionForTeams(teams, teamToSection) {
  for (const team of teams || []) if (teamToSection[team]) return teamToSection[team];
  if ((teams || []).some((t) => /delivery|technolog/i.test(t))) return 'delivery';
  return null; // unknown team (or none) — infer from the role instead
}

/** Canonicalize role tags via config.labelAliases ({ canonical: [aliases…] }). */
export function applyLabelAliases(tags, labelAliases) {
  const reverse = new Map();
  for (const [canonical, aliases] of Object.entries(labelAliases || {})) {
    for (const a of aliases) reverse.set(norm(a), canonical);
  }
  return (tags || []).map((t) => reverse.get(norm(t)) || t);
}

// "Senior AI System Engineer" carries its level inside the title — used only
// when no explicit level tag exists.
function embeddedLevel(roles, levelTokens) {
  const words = new Set(toTokens(roles.join(' ')));
  let best = null;
  let bestRank = -1;
  for (let rank = 0; rank < levelTokens.length; rank++) {
    const tokens = toTokens(levelTokens[rank]);
    if (tokens.length && tokens.every((t) => words.has(t)) && rank > bestRank) {
      bestRank = rank;
      best = levelTokens[rank];
    }
  }
  return best;
}

function pickHighestLevel(levels, levelTokens) {
  let best = null;
  let bestRank = -1;
  for (const l of levels) {
    const rank = levelTokens.findIndex((t) => norm(t) === norm(l));
    if (rank > bestRank) {
      bestRank = rank;
      best = l;
    }
  }
  return best;
}

/** Split a Notion `Role / Seniority Level` multi-select into category/role/level + section. */
export function classifyEmployee(emp, config) {
  const tags = applyLabelAliases(emp.roleTags, config.labelAliases);
  const levels = tags.filter((t) => isLevel(t, config.levelTokens));
  const roles = tags.filter((t) => !isLevel(t, config.levelTokens));
  let category = categoryFor(roles);
  const level = pickHighestLevel(levels, config.levelTokens) || embeddedLevel(roles, config.levelTokens);
  let section = sectionForTeams(emp.teams, config.teamToSection);
  if (!section) section = category !== 'other' ? 'delivery' : 'business';
  // A bare level tag ("Senior 2") with no role text on a delivery team is a developer.
  if (category === 'other' && level && section === 'delivery') category = 'developers';
  return {
    section,
    category,
    level,
    roleFamily: roles[0] || null,
    roles,
  };
}

// Token equality with prefix tolerance so "eng" ~ "engineer", "dev" ~ "developer".
function tokEq(a, b) {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return l.startsWith(s) && s.length >= 3;
}

function scoreTitle(empTokens, bandTokens) {
  let matched = 0;
  for (const t of empTokens) if (bandTokens.some((b) => tokEq(t, b))) matched++;
  if (matched < empTokens.length) return -Infinity; // every employee token must be present
  return matched * 10 - (bandTokens.length - matched); // fewer extra band tokens = better fit
}

function findBand(bands, classified, contractType) {
  const pool = bands.filter(
    (b) => b.section === classified.section && b.contractType === contractType && b.category === classified.category,
  );
  if (!pool.length) return null;

  if (classified.category === 'developers') {
    if (!classified.level) return null;
    const L = norm(classified.level);
    return (
      pool.find((b) => norm(b.label) === L) ||
      pool.find((b) => norm(b.label).startsWith(L) || L.startsWith(norm(b.label))) ||
      null
    );
  }

  // QA / Portfolio / other: score employee role+level tokens against band title.
  const empTokens = toTokens([classified.roleFamily, classified.level].filter(Boolean).join(' '));
  if (!empTokens.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const b of pool) {
    const s = scoreTitle(empTokens, toTokens(b.label));
    if (s > bestScore) {
      bestScore = s;
      best = b;
    }
  }
  return bestScore > -Infinity ? best : null;
}

/** Resolve to a {min,max} band, honoring config.contractType ("B2B"|"CoE"|"average"). */
export function resolveBand(bands, classified, config) {
  const ct = config.contractType || 'B2B';
  if (ct === 'average') {
    const a = findBand(bands, classified, 'B2B');
    const b = findBand(bands, classified, 'CoE');
    if (a && b) return { min: (a.min + b.min) / 2, max: (a.max + b.max) / 2 };
    return a || b || null;
  }
  const other = ct === 'B2B' ? 'CoE' : 'B2B';
  return findBand(bands, classified, ct) || findBand(bands, classified, other);
}

export const bandPointValue = (min, max, mode) =>
  mode === 'min' ? min : mode === 'max' ? max : (min + max) / 2;

export const annualize = (amount, period) => (period === 'monthly' ? amount * 12 : amount);

export function computeRatePerMinute(annualGross, config) {
  return (annualGross * config.overheadMultiplier) / (config.hoursPerYear * 60);
}

export function roundSig(n, sig) {
  if (!n || !Number.isFinite(n)) return 0;
  const d = Math.ceil(Math.log10(Math.abs(n)));
  const mult = Math.pow(10, sig - d);
  return Math.round(n * mult) / mult;
}

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/** @returns {{ people, defaultRatePerMinute, matchedCount, unmatched }} */
export function buildRates({ employees, salaryTable, config }) {
  const people = [];
  const rates = [];
  const unmatched = [];

  for (const emp of employees) {
    const classified = classifyEmployee(emp, config);
    const band = resolveBand(salaryTable, classified, config);
    if (!band) {
      unmatched.push({ emp, classified });
      continue;
    }
    const annual = annualize(bandPointValue(band.min, band.max, config.bandPoint), config.period);
    const rate = roundSig(computeRatePerMinute(annual, config), config.rateRoundingSignificantDigits);
    people.push({ keys: buildKeys(emp), ratePerMinute: rate });
    rates.push(rate);
  }

  const defaultRatePerMinute = roundSig(mean(rates), config.rateRoundingSignificantDigits);
  return { people, defaultRatePerMinute, matchedCount: people.length, unmatched };
}
