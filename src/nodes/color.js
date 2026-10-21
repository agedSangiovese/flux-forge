/**
 * Colour nodes.
 *
 * Colours travel as a `#rrggbb` string, an `{r,g,b}` object (sRGB 0..1) or a
 * field function. Whenever every input to a node is provably constant we fold
 * the result back into a constant colour (hex string or const-tagged field) —
 * downstream that means the renderer skips vertex-colour baking entirely.
 */
import { define } from './define.js';
import { hexToSRGB, srgbToHex } from '../core/values.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** True when a colour input can never vary across space. */
const constColor = (ctx, v) => !ctx.isFn(v) || ctx.isConstField(v);

const lerp = (a, b, t) => a + (b - a) * t;
const lerpColor = (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) });

// -------------------------------------------------------------- colour.solid

define('color.solid', (ctx, inputs) => {
  const v = inputs.color;
  // A varying colour passes straight through; a constant one becomes hex so
  // downstream nodes can fold it.
  if (ctx.isFn(v) && !ctx.isConstField(v)) return { out: v };
  return { out: ctx.toHex(v) };
});

// --------------------------------------------------------------- color.ramp

const DEFAULT_STOPS = [
  { t: 0, c: '#0b1d3a' },
  { t: 0.5, c: '#7b2ff7' },
  { t: 1, c: '#f107a3' },
];

/** Sort + sanitise the gradient widget's stop list. */
export function normaliseStops(stops) {
  const list = (Array.isArray(stops) ? stops : [])
    .filter((s) => s && s.c != null)
    .map((s) => ({ t: Number.isFinite(Number(s.t)) ? Number(s.t) : 0, c: String(s.c) }))
    .sort((a, b) => a.t - b.t);
  return list.length ? list : DEFAULT_STOPS;
}

/** Evaluate a stop list at t (0..1 expected, clamped to the end stops). */
export function sampleStops(stops, t) {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (t <= first.t) return hexToSRGB(first.c);
  if (t >= last.t) return hexToSRGB(last.c);
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i];
    if (t <= b.t) {
      const a = stops[i - 1];
      const span = b.t - a.t;
      return lerpColor(hexToSRGB(a.c), hexToSRGB(b.c), span <= 0 ? 0 : (t - a.t) / span);
    }
  }
  return hexToSRGB(last.c);
}

define('color.ramp', (ctx, inputs) => {
  const value = inputs.value;
  const stops = normaliseStops(inputs.stops);
  const low = Number.isFinite(Number(inputs.low)) ? Number(inputs.low) : 0;
  const high = Number.isFinite(Number(inputs.high)) ? Number(inputs.high) : 1;
  const gamma = Number.isFinite(Number(inputs.gamma)) && inputs.gamma > 0 ? Number(inputs.gamma) : 1;
  const repeat = !!inputs.repeat;

  const evalAt = (v) => {
    let t = high === low ? 0 : (v - low) / (high - low);
    if (repeat) t -= Math.floor(t); // wraps for negative inputs too
    else t = clamp01(t);
    if (gamma !== 1) t = Math.pow(t, gamma);
    return sampleStops(stops, t);
  };

  if (ctx.isConstField(value)) return { out: ctx.toColorField(evalAt(ctx.constValueOf(value))) };
  const field = (x, y, z, fctx) => evalAt(ctx.sample(value, x, y, z, fctx, 0));
  return { out: field };
});

// ----------------------------------------------------------------- color.hsv

function rgbToHsl(c) {
  const r = c.r;
  const g = c.g;
  const b = c.b;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: hue(h + 1 / 3), g: hue(h), b: hue(h - 1 / 3) };
}

define('color.hsv', (ctx, inputs) => {
  const base = inputs.color;
  const hAdj = (Number(inputs.hue) || 0) / 360;
  const sAdj = Number(inputs.saturation) || 0;
  const lAdj = Number(inputs.lightness) || 0;

  const adjust = (c) => {
    const { h, s, l } = rgbToHsl(c);
    const nh = h + hAdj - Math.floor(h + hAdj); // wrap hue
    return hslToRgb(nh, clamp01(s + sAdj), clamp01(l + lAdj));
  };

  if (constColor(ctx, base)) return { out: ctx.toHex(adjust(ctx.sampleColor(base, 0, 0, 0))) };
  const field = (x, y, z, fctx) => adjust(ctx.sampleColor(base, x, y, z, fctx));
  return { out: field };
});

// -------------------------------------------------------------- color.blend

/** Per-channel blend modes; `mix` is a straight lerp, the rest blend A with
 *  the mode result under the Amount slider. */
function blendChannel(mode, a, b, k) {
  let m;
  switch (mode) {
    case 'multiply':
      m = a * b;
      break;
    case 'screen':
      m = 1 - (1 - a) * (1 - b);
      break;
    case 'add':
      m = clamp01(a + b);
      break;
    case 'overlay':
      m = a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b);
      break;
    case 'difference':
      m = Math.abs(a - b);
      break;
    case 'softlight': {
      // W3C soft-light curve.
      const d = a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a);
      m = b <= 0.5 ? a - (1 - 2 * b) * a * (1 - a) : a + (2 * b - 1) * (d - a);
      break;
    }
    case 'mix':
    default:
      return lerp(a, b, k);
  }
  return lerp(a, m, k);
}

define('color.blend', (ctx, inputs) => {
  const { a, b, t } = inputs;
  const mode = inputs.mode || 'mix';
  const compute = (ca, cb, k) => ({
    r: blendChannel(mode, ca.r, cb.r, k),
    g: blendChannel(mode, ca.g, cb.g, k),
    b: blendChannel(mode, ca.b, cb.b, k),
  });

  if (constColor(ctx, a) && constColor(ctx, b) && ctx.isConstField(t)) {
    return {
      out: ctx.toHex(
        compute(ctx.sampleColor(a, 0, 0, 0), ctx.sampleColor(b, 0, 0, 0), ctx.constValueOf(t))
      ),
    };
  }
  const field = (x, y, z, fctx) =>
    compute(
      ctx.sampleColor(a, x, y, z, fctx),
      ctx.sampleColor(b, x, y, z, fctx),
      ctx.sample(t, x, y, z, fctx, 0.5)
    );
  return { out: field };
});

// ------------------------------------------------------------- color.palette

const PALETTES = {
  sunset: ['#2b1055', '#7d2a8c', '#e0526a', '#ff9a56', '#fff1b8'],
  ocean: ['#011627', '#073b4c', '#118ab2', '#06d6a0', '#bdefff'],
  forest: ['#081c15', '#1b4332', '#2d6a4f', '#74c69d', '#d8f3dc'],
  neon: ['#0d0015', '#f72585', '#b5179e', '#7209b7', '#4cc9f0'],
  candy: ['#fff5fa', '#ffb3d1', '#ff7ab8', '#c77dff', '#a0e7e5'],
  ember: ['#0c0000', '#3d0000', '#9b2226', '#ee9b00', '#ffe9a8'],
  aurora: ['#020617', '#0b3954', '#1b998b', '#5df0c0', '#d7fdf5'],
  mono: ['#0a0a0a', '#404040', '#8a8a8a', '#d4d4d4', '#ffffff'],
};

define('color.palette', (ctx, inputs) => {
  const name = PALETTES[inputs.palette] ? inputs.palette : 'sunset';
  const stops = PALETTES[name].map((c, idx, arr) => ({ t: idx / (arr.length - 1), c: c }));
  const t = inputs.t;

  if (ctx.isConstField(t)) return { out: ctx.toHex(sampleStops(stops, clamp01(ctx.constValueOf(t)))) };
  const field = (x, y, z, fctx) => sampleStops(stops, clamp01(ctx.sample(t, x, y, z, fctx, 0)));
  return { out: field };
});
