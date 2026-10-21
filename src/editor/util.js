/**
 * Shared helpers for the Flux Forge node-editor modules.
 *
 * Pure functions plus tiny DOM builders — no editor state lives here, so every
 * module can import freely without creating cycles.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag, cls = '', text = null) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== null && text !== undefined) node.textContent = text;
  return node;
}

export function svgEl(tag, attrs = null) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
  return node;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** addEventListener that remembers how to remove itself. */
export function bind(target, type, fn, opts, cleanups) {
  target.addEventListener(type, fn, opts);
  cleanups.push(() => target.removeEventListener(type, fn, opts));
}

export function isTyping(target) {
  if (!target || !target.tagName) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable === true
  );
}

export function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Format a number for a readout, honouring the widget's step. */
export function fmtNum(v, step = 0.01) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e6) return String(n);
  const abs = Math.abs(n);
  let decimals;
  if (abs >= 1000) decimals = 0;
  else if (abs >= 100) decimals = 1;
  else {
    const s = Math.abs(Number(step)) || 0.01;
    decimals = s >= 1 ? 0 : s >= 0.1 ? 1 : s >= 0.01 ? 2 : s >= 0.001 ? 3 : 4;
  }
  let out = n.toFixed(decimals);
  if (out.indexOf('.') >= 0) out = out.replace(/0+$/, '').replace(/\.$/, '');
  if (out === '-0') out = '0';
  return out;
}

// ------------------------------------------------------------------- colours

export function normHex(c) {
  if (typeof c !== 'string') return '#ffffff';
  let s = c.trim();
  if (!s) return '#ffffff';
  if (s[0] !== '#') s = `#${s}`;
  if (/^#[0-9a-f]{3}$/i.test(s)) s = `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : '#ffffff';
}

export function hexToRgb(c) {
  const s = normHex(c);
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
}

export function mixHex(a, b, t) {
  const k = clamp(t, 0, 1);
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const out = A.map((v, i) => Math.round(v + (B[i] - v) * k));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** `[{t,c}]` → a CSS linear-gradient() declaration. */
export function gradientCss(stops) {
  const list = [...stops].sort((a, b) => a.t - b.t);
  if (!list.length) return 'linear-gradient(90deg, #000, #fff)';
  const parts = list.map((s) => `${normHex(s.c)} ${(clamp(s.t, 0, 1) * 100).toFixed(2)}%`);
  if (list[0].t > 0) parts.unshift(`${normHex(list[0].c)} 0%`);
  if (list[list.length - 1].t < 1) parts.push(`${normHex(list[list.length - 1].c)} 100%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

export function normStops(value, fallback) {
  const src = Array.isArray(value) && value.length ? value : fallback;
  if (!Array.isArray(src) || !src.length) return [{ t: 0, c: '#000000' }, { t: 1, c: '#ffffff' }];
  return src
    .map((s) => ({ t: clamp(Number(s && s.t) || 0, 0, 1), c: normHex((s && s.c) || '#ffffff') }))
    .sort((a, b) => a.t - b.t);
}

export function sampleStops(stops, t) {
  const list = [...stops].sort((a, b) => a.t - b.t);
  if (!list.length) return '#ffffff';
  const k = clamp(t, 0, 1);
  if (k <= list[0].t) return list[0].c;
  if (k >= list[list.length - 1].t) return list[list.length - 1].c;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    if (k >= a.t && k <= b.t) {
      const span = b.t - a.t || 1;
      return mixHex(a.c, b.c, (k - a.t) / span);
    }
  }
  return list[list.length - 1].c;
}

// -------------------------------------------------------------------- search

/**
 * Subsequence fuzzy match.
 * @returns {{score:number, indices:number[]}|null} null when it does not match.
 */
export function fuzzyMatch(query, text) {
  const hay = String(text || '');
  if (!query) return { score: 0, indices: [] };
  const q = String(query).toLowerCase();
  const h = hay.toLowerCase();
  let hi = 0;
  let score = 0;
  let streak = 0;
  const indices = [];
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    if (ch === ' ') continue;
    let found = -1;
    for (let i = hi; i < h.length; i++) {
      if (h[i] === ch) {
        found = i;
        break;
      }
    }
    if (found < 0) return null;
    let bonus = 1;
    if (found === 0) bonus += 10;
    else if (' ._-/'.indexOf(h[found - 1]) >= 0) bonus += 6;
    if (indices.length && found === indices[indices.length - 1] + 1) {
      streak += 1;
      bonus += streak * 3;
    } else {
      streak = 0;
    }
    score += bonus;
    indices.push(found);
    hi = found + 1;
  }
  // Prefer compact matches: rank "Sphere" above something containing the same
  // letters spread over a long description.
  score += Math.max(0, 24 - hay.length * 0.12);
  return { score, indices };
}

/** Highlight the matched characters of `text` for `query`. */
export function markMatch(query, text, cls = 'ns-hl') {
  const m = fuzzyMatch(query, text);
  if (!m || !m.indices.length) return escapeHtml(text);
  const set = new Set(m.indices);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = escapeHtml(text[i]);
    out += set.has(i) ? `<mark class="${cls}">${ch}</mark>` : ch;
  }
  return out;
}
