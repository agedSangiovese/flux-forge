/**
 * Runtime value helpers.
 *
 * Scalars travel as either a constant `number` or a field function
 * `(x, y, z, ctx) => number`. Colours travel as a hex string, an `{r,g,b}`
 * object, or a field function returning `{r,g,b}` (sRGB 0..1).
 *
 * Fields created from constants are tagged with `isConst` / `constValue` so
 * downstream nodes can collapse a whole constant branch back into a plain
 * value instead of needlessly baking vertex colours.
 */

import * as THREE from 'three';
import { gexpr, gfloat } from './glsl.js';

export const isFn = (v) => typeof v === 'function';

// ---------------------------------------------------------------- scalars

/** Tag a function as a provable constant. */
function constTag(fn, value) {
  fn.isConst = true;
  fn.constValue = value;
  return fn;
}

export function constField(n) {
  return constTag(() => n, n);
}

/** Coerce anything scalar-ish into a field function. */
export function toField(value, fallback = 0) {
  if (isFn(value)) return value;
  const n = toNum(value, fallback);
  return constField(n);
}

/** If `fn` is a constant field, return its value; otherwise `undefined`. */
export function constValueOf(fn) {
  return fn && fn.isConst ? fn.constValue : undefined;
}

export function isConstField(fn) {
  return !!(fn && fn.isConst);
}

export function toNum(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    if (Number.isFinite(n)) return n;
  }
  if (value && typeof value === 'object' && 'r' in value) return luminance(value);
  const f = Number(fallback);
  return Number.isFinite(f) ? f : 0;
}

/**
 * Sample a scalar-ish value at a point.
 * Accepts numbers, field functions, colour objects (via luminance) and
 * anything that fails to parse, which falls back instead of throwing.
 */
export function sample(value, x = 0, y = 0, z = 0, ctx = null, fallback = 0) {
  if (isFn(value)) {
    let r;
    try {
      r = value(x, y, z, ctx);
    } catch {
      return fallback;
    }
    if (r && typeof r === 'object' && 'r' in r) return luminance(r);
    const n = Number(r);
    return Number.isFinite(n) ? n : fallback;
  }
  return toNum(value, fallback);
}

// ----------------------------------------------------------------- colours

/** Parse `#rgb` / `#rrggbb` / numeric hex into sRGB 0..1 (no colour management). */
export function hexToSRGB(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const i = Math.abs(Math.trunc(value)) & 0xffffff;
    return { r: ((i >> 16) & 255) / 255, g: ((i >> 8) & 255) / 255, b: (i & 255) / 255 };
  }
  let s = String(value == null ? '#ffffff' : value).trim().replace(/^#/, '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (s.length !== 6) return { r: 1, g: 1, b: 1 };
  const int = parseInt(s, 16);
  if (!Number.isFinite(int)) return { r: 1, g: 1, b: 1 };
  return { r: ((int >> 16) & 255) / 255, g: ((int >> 8) & 255) / 255, b: (int & 255) / 255 };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function srgbToHex(c) {
  const q = (v) => Math.max(0, Math.min(255, Math.round(clamp01(v) * 255)));
  return '#' + ((1 << 24) | (q(c.r) << 16) | (q(c.g) << 8) | q(c.b)).toString(16).slice(1);
}

export function luminance(c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** sRGB -> linear, the transfer function three uses for vertex colours. */
export function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** Coerce anything colour-ish into a colour field function. */
export function toColorField(value, fallback = '#ffffff') {
  if (isFn(value)) return value;
  if (value && typeof value === 'object' && 'r' in value) {
    const c = { r: value.r, g: value.g, b: value.b };
    return constTag(() => ({ r: c.r, g: c.g, b: c.b }), c);
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const c = hexToSRGB(value);
    return constTag(() => ({ r: c.r, g: c.g, b: c.b }), c);
  }
  const d = hexToSRGB(fallback);
  return constTag(() => ({ r: d.r, g: d.g, b: d.b }), d);
}

/** Sample a colour-ish value at a point. Always returns a fresh `{r,g,b}`. */
export function sampleColor(value, x = 0, y = 0, z = 0, ctx = null) {
  if (isFn(value)) {
    let r;
    try {
      r = value(x, y, z, ctx);
    } catch {
      return { r: 1, g: 1, b: 1 };
    }
    if (r && typeof r === 'object' && 'r' in r) return { r: r.r, g: r.g, b: r.b };
    const n = Number(r);
    if (Number.isFinite(n)) return { r: n, g: n, b: n };
    return { r: 1, g: 1, b: 1 };
  }
  if (value && typeof value === 'object' && 'r' in value) return { r: value.r, g: value.g, b: value.b };
  if (typeof value === 'string' || typeof value === 'number') return hexToSRGB(value);
  return { r: 1, g: 1, b: 1 };
}

/** Normalise any colour-ish value to a `#rrggbb` string (for params / UI). */
export function toHex(value) {
  if (typeof value === 'string') return value.length === 4 || value.length === 7 ? value : '#ffffff';
  if (isFn(value)) return srgbToHex(value.isConst ? value.constValue : sampleColor(value, 0, 0, 0));
  if (value && typeof value === 'object' && 'r' in value) return srgbToHex(value);
  if (typeof value === 'number') return srgbToHex(hexToSRGB(value));
  return '#ffffff';
}

/** Build a THREE.Color from an sRGB triple. */
export function makeColor(c) {
  return new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
}

// ------------------------------------------------------------- coercion

export function defaultForType(type) {
  switch (type) {
    case 'number':
    case 'field':
      return 0;
    case 'color':
      return '#ffffff';
    case 'shader':
      return gexpr(1, '0.0');
    case 'texture':
      return null;
    default:
      return null;
  }
}

/**
 * Turn a raw wire/param value into the exact shape the receiving port declared.
 *
 * @param {*} value            value on the wire (or the param/default if unwired)
 * @param {string} targetType  declared type of the receiving port
 * @param {string} sourceType  declared type of the sending port (best effort)
 * @param {*} fallback         value to use when `value` is null/undefined
 */
export function coerce(value, targetType, sourceType, fallback) {
  let v = value === undefined || value === null ? fallback : value;
  if (v === undefined || v === null) v = defaultForType(targetType);

  if (targetType === 'number') {
    if (sourceType === 'color') return luminance(sampleColor(v, 0, 0, 0));
    if (isFn(v)) return sample(v, 0, 0, 0, null, toNum(fallback));
    return toNum(v, fallback);
  }

  if (targetType === 'field') {
    if (sourceType === 'color') {
      if (isFn(v)) {
        if (v.isConst) return constField(luminance(v.constValue));
        return (x, y, z, ctx) => luminance(sampleColor(v, x, y, z, ctx));
      }
      return constField(luminance(sampleColor(v, 0, 0, 0)));
    }
    return toField(v, toNum(fallback, 0));
  }

  if (targetType === 'color') {
    if (sourceType === 'number' || sourceType === 'field') {
      const field = toField(v, toNum(fallback, 1));
      const grey = (n) => {
        const g = clamp01(n);
        return { r: g, g: g, b: g };
      };
      if (field.isConst) {
        const c = grey(field.constValue);
        return constTag(() => ({ r: c.r, g: c.g, b: c.b }), c);
      }
      return (x, y, z, ctx) => grey(sample(field, x, y, z, ctx, 1));
    }
    return v;
  }

  if (targetType === 'shader') {
    if (v && v.kind === 'expr') return v;
    if (typeof v === 'number') return gexpr(1, gfloat(v));
    if (isFn(v)) {
      const n = sample(v, 0, 0, 0, null, NaN);
      return gexpr(1, gfloat(Number.isFinite(n) ? n : 0));
    }
    if (v && typeof v === 'object' && 'r' in v) {
      return gexpr(3, `vec3(${gfloat(v.r)}, ${gfloat(v.g)}, ${gfloat(v.b)})`);
    }
    if (sourceType === 'color' || (typeof v === 'string' && /^#/.test(v.trim()))) {
      const c = hexToSRGB(v);
      return gexpr(3, `vec3(${gfloat(c.r)}, ${gfloat(c.g)}, ${gfloat(c.b)})`);
    }
    if (typeof v === 'string') {
      const n = parseFloat(v);
      if (Number.isFinite(n)) return gexpr(1, gfloat(n));
    }
    return gexpr(1, '0.0');
  }

  if (targetType === 'texture') {
    if (v && v.kind === 'texture') return v;
    return null;
  }

  return v;
}
