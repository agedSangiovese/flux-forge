/**
 * Field nodes — patterns that vary across space.
 *
 * Every node here returns a function `(x, y, z, fieldCtx) => number`. The
 * engine hands geometry-aware callers (the output node, Displace, …) a field
 * context carrying the object's `min` / `max` / `size` / `center` / `radius`;
 * nodes that normalise against the object use `frameOf()` and gracefully fall
 * back to raw coordinates when those bounds are absent.
 */
import { define } from './define.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v) => v - Math.floor(v);

/**
 * Bounds of the object the field is painted on, or null when the engine's
 * base context (min == max, all zeros) is all we have.
 */
export function frameOf(fctx) {
  const mn = fctx && fctx.min;
  const mx = fctx && fctx.max;
  if (!mn || !mx) return null;
  if (mn[0] === mx[0] && mn[1] === mx[1] && mn[2] === mx[2]) return null;
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const radius =
    fctx.radius && fctx.radius > 0 ? fctx.radius : 0.5 * Math.hypot(size[0], size[1], size[2]);
  return {
    min: mn,
    max: mx,
    size,
    center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2],
    radius,
  };
}

// ------------------------------------------------------------------ noise

define('field.noise', (ctx, inputs) => {
  const noise = ctx.noise(inputs.seed | 0);
  const opts = {
    scale: inputs.scale,
    octaves: inputs.octaves,
    persistence: inputs.persistence,
    lacunarity: inputs.lacunarity,
    mode: inputs.mode,
    seed: inputs.seed,
  };
  const white = inputs.mode === 'white'; // fbm returns 0..1 for white noise
  const positive = inputs.range === 'positive';
  const ox = inputs.ox;
  const oy = inputs.oy;
  const oz = inputs.oz;

  const field = (x, y, z) => {
    let v = ctx.fbm(noise, x + ox, y + oy, z + oz, opts);
    if (white) v = positive ? v : v * 2 - 1;
    else if (positive) v = v * 0.5 + 0.5;
    return v;
  };
  return { out: field };
});

// 4-D noise: identical controls, plus a wireable W coordinate. W is a genuine
// fourth spatial axis — sweep it and the pattern morphs in place (nearby
// slices correlate smoothly, distant ones are unrelated) instead of flowing.
define('field.noise4', (ctx, inputs) => {
  const noise = ctx.noise4(inputs.seed | 0);
  const opts = {
    scale: inputs.scale,
    octaves: inputs.octaves,
    persistence: inputs.persistence,
    lacunarity: inputs.lacunarity,
    mode: inputs.mode,
    seed: inputs.seed,
    w: Number.isFinite(Number(inputs.w)) ? Number(inputs.w) : 0,
  };
  const white = inputs.mode === 'white'; // fbm returns 0..1 for white noise
  const positive = inputs.range === 'positive';
  const ox = inputs.ox;
  const oy = inputs.oy;
  const oz = inputs.oz;

  const field = (x, y, z) => {
    let v = ctx.fbm(noise, x + ox, y + oy, z + oz, opts);
    if (white) v = positive ? v : v * 2 - 1;
    else if (positive) v = v * 0.5 + 0.5;
    return v;
  };
  return { out: field };
});

define('field.voronoi', (ctx, inputs) => {
  const seed = inputs.seed | 0;
  const scale = inputs.scale;
  const jitter = inputs.jitter;
  const mode = inputs.mode || 'edge';
  const normalise = inputs.range === '01';

  const field = (x, y, z) => {
    const r = ctx.voronoi(x, y, z, { scale, jitter, seed });
    let v;
    if (mode === 'f1') v = r.f1;
    else if (mode === 'f2') v = r.f2;
    else if (mode === 'cell') v = r.id;
    else v = r.f2 - r.f1; // edge cracks: gap between the two nearest cells
    return normalise ? clamp01(v) : v;
  };
  return { out: field };
});

// ---------------------------------------------------------------- checker

define('field.checker', (ctx, inputs) => {
  const s = inputs.scale;
  const ox = inputs.ox;
  const oy = inputs.oy;
  const oz = inputs.oz;
  const mode = inputs.mode || 'checker';
  const parity = (n) => (((n % 2) + 2) % 2);

  const field = (x, y, z) => {
    const px = (x + ox) * s;
    const py = (y + oy) * s;
    const pz = (z + oz) * s;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const iz = Math.floor(pz);

    if (mode === 'bars') return parity(ix) === 0 ? 1 : 0;
    if (mode === 'grid') {
      // Soft lines hugging the nearest cell boundary on any axis.
      const dx = Math.min(fract(px), 1 - fract(px));
      const dy = Math.min(fract(py), 1 - fract(py));
      const dz = Math.min(fract(pz), 1 - fract(pz));
      return 1 - ctx.smoothstep(0.02, 0.09, Math.min(dx, Math.min(dy, dz)));
    }
    return parity(ix) + parity(iy) + parity(iz) === 1 ? 1 : 0;
  };
  return { out: field };
});

// --------------------------------------------------------------- gradient

define('field.gradient', (ctx, inputs) => {
  const axis = inputs.axis || 'y';
  const start = Number(inputs.start) || 0;
  const end = Number.isFinite(Number(inputs.end)) ? Number(inputs.end) : 1;
  const clamp = !!inputs.clamp;

  const field = (x, y, z, fctx) => {
    const frame = frameOf(fctx);
    let t;
    if (axis === 'radial') {
      const cx = frame ? frame.center[0] : 0;
      const cy = frame ? frame.center[1] : 0;
      const cz = frame ? frame.center[2] : 0;
      const d = Math.hypot(x - cx, y - cy, z - cz);
      t = frame ? d / (frame.radius || 1) : d;
    } else if (axis === 'diagonal') {
      if (frame) {
        t =
          ((x - frame.min[0]) / (frame.size[0] || 1) +
            (y - frame.min[1]) / (frame.size[1] || 1) +
            (z - frame.min[2]) / (frame.size[2] || 1)) /
          3;
      } else {
        t = (x + y + z) / 3;
      }
    } else {
      const a = axis === 'x' ? 0 : axis === 'z' ? 2 : 1;
      const v = a === 0 ? x : a === 1 ? y : z;
      t = frame ? (v - frame.min[a]) / (frame.size[a] || 1) : v;
    }
    if (clamp) t = clamp01(t);
    return start + (end - start) * t;
  };
  return { out: field };
});

// ------------------------------------------------------------------ rings

define('field.rings', (ctx, inputs) => {
  const freq = Number(inputs.frequency) || 0;
  const soft = clamp01(Number(inputs.softness) || 0);
  const cx = Number(inputs.cx) || 0;
  const cy = Number(inputs.cy) || 0;
  const cz = Number(inputs.cz) || 0;

  const field = (x, y, z, fctx) => {
    const frame = frameOf(fctx);
    let d = Math.hypot(x - cx, y - cy, z - cz);
    if (frame) d /= frame.radius || 1;
    const u = fract(d * freq); // 0 at every ring centre
    const hard = u < 0.5 ? 1 : 0;
    const wave = 0.5 - 0.5 * Math.cos((u - 0.5) * TAU); // same phase, soft edges
    return hard * (1 - soft) + wave * soft;
  };
  return { out: field };
});

// ------------------------------------------------------------------- wave

/** Bipolar waveforms in -1..1; square/pulse are hard 1/0 gates. */
function applyWave(waveform, t, duty) {
  const u = fract(t);
  switch (waveform) {
    case 'triangle':
      return u < 0.5 ? 4 * u - 1 : 3 - 4 * u;
    case 'saw':
      return 2 * u - 1;
    case 'square':
      return u < duty ? 1 : 0;
    case 'pulse':
      return u < duty ? 1 : -1;
    case 'sine':
    default:
      return Math.sin(u * TAU);
  }
}

define('field.wave', (ctx, inputs) => {
  const input = inputs.input;
  const waveform = inputs.waveform || 'sine';
  const freq = Number(inputs.frequency) || 0;
  const phase = Number(inputs.phase) || 0;
  const duty = clamp01(Number(inputs.duty) || 0.5);
  const amp = Number.isFinite(Number(inputs.amplitude)) ? Number(inputs.amplitude) : 1;
  const offset = Number(inputs.offset) || 0;

  const shape = (v) => amp * applyWave(waveform, v * freq + phase, duty) + offset;

  // A constant input can never produce variety — fold straight to a number.
  if (ctx.isConstField(input)) return { out: ctx.toField(shape(ctx.constValueOf(input))) };

  const field = (x, y, z, fctx) => shape(ctx.sample(input, x, y, z, fctx, 0));
  return { out: field };
});

// --------------------------------------------------------------- position

define('field.position', (ctx, inputs) => {
  const axis = inputs.axis || 'x';
  const start = Number(inputs.start) || 0;
  const end = Number.isFinite(Number(inputs.end)) ? Number(inputs.end) : 1;
  const normalise = !!inputs.clamp; // widget is labelled "Normalise"

  const field = (x, y, z, fctx) => {
    let v;
    if (axis === 'radius') v = Math.hypot(x, y, z);
    else if (axis === 'angle') v = Math.atan2(z, x); // angle around Y
    else v = axis === 'y' ? y : axis === 'z' ? z : x;

    if (!normalise) return v;
    if (axis === 'angle') return (v + Math.PI) / TAU;

    const frame = frameOf(fctx);
    let t;
    if (axis === 'radius') {
      t = frame ? v / (frame.radius || 1) : (v - start) / ((end - start) || 1);
    } else if (frame) {
      const a = axis === 'y' ? 1 : axis === 'z' ? 2 : 0;
      t = (v - frame.min[a]) / (frame.size[a] || 1);
    } else {
      t = (v - start) / ((end - start) || 1);
    }
    return clamp01(t);
  };
  return { out: field };
});

// ------------------------------------------------------------------- warp

define('field.warp', (ctx, inputs) => {
  const { value, dx, dy, dz } = inputs;
  const amount = Number.isFinite(Number(inputs.amount)) ? Number(inputs.amount) : 1;

  // Shifting the sample point of a constant pattern changes nothing.
  if (ctx.isConstField(value)) return { out: ctx.toField(ctx.constValueOf(value)) };

  const field = (x, y, z, fctx) => {
    const sx = ctx.sample(dx, x, y, z, fctx, 0) * amount;
    const sy = ctx.sample(dy, x, y, z, fctx, 0) * amount;
    const sz = ctx.sample(dz, x, y, z, fctx, 0) * amount;
    return ctx.sample(value, x + sx, y + sy, z + sz, fctx, 0);
  };
  return { out: field };
});

// ----------------------------------------------------------------- random

define('field.random', (ctx, inputs) => {
  const scale = inputs.scale;
  const seed = inputs.seed | 0;
  // White noise per quantised cell — every cell an unrelated 0..1 value.
  const field = (x, y, z) =>
    ctx.hash3(Math.floor(x * scale), Math.floor(y * scale), Math.floor(z * scale), seed);
  return { out: field };
});
