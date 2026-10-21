/**
 * Math nodes — combine and reshape values.
 *
 * Every port here is a `field`, but the engine wraps constants in
 * provably-constant functions (tagged `isConst`). Whenever every field input
 * of a node is constant we collapse the whole thing to a plain number: the
 * result arrives downstream already wrapped in a constant field again, so
 * folds chain all the way to the material, where a constant colour means the
 * renderer never has to bake vertex colours.
 */
import { define } from './define.js';

const finiteOr = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);

/** Build a two-input field node with const-folding. */
function binary(type, op) {
  define(type, (ctx, inputs) => {
    const a = inputs.a;
    const b = inputs.b;
    if (ctx.isConstField(a) && ctx.isConstField(b)) {
      return { out: finiteOr(op(ctx.constValueOf(a), ctx.constValueOf(b))) };
    }
    return {
      out: (x, y, z, fctx) =>
        finiteOr(op(ctx.sample(a, x, y, z, fctx, 0), ctx.sample(b, x, y, z, fctx, 0))),
    };
  });
}

/** Build a single-input field node with const-folding. */
function unary(type, op) {
  define(type, (ctx, inputs) => {
    const a = inputs.a;
    if (ctx.isConstField(a)) return { out: finiteOr(op(ctx.constValueOf(a))) };
    return { out: (x, y, z, fctx) => finiteOr(op(ctx.sample(a, x, y, z, fctx, 0))) };
  });
}

/** Build a node from several field inputs described by `keys`. */
function nary(type, keys, compute) {
  define(type, (ctx, inputs) => {
    const fields = keys.map((k) => inputs[k]);
    if (fields.every((f) => ctx.isConstField(f))) {
      const consts = fields.map((f) => ctx.constValueOf(f));
      return { out: finiteOr(compute(...consts, ctx)) };
    }
    return {
      out: (x, y, z, fctx) =>
        finiteOr(compute(...fields.map((f) => ctx.sample(f, x, y, z, fctx, 0)), ctx)),
    };
  });
}

// ------------------------------------------------------------- arithmetic

binary('math.add', (a, b) => a + b);
binary('math.subtract', (a, b) => a - b);
binary('math.multiply', (a, b) => a * b);
binary('math.divide', (a, b) => (b === 0 ? 0 : a / b)); // zero guard
binary('math.power', (a, b) => {
  const v = Math.pow(a, b);
  return Number.isFinite(v) ? v : 0; // negative base + fractional exponent
});
// Positive modulo: -0.3 wraps to 0.7, so a value repeats 0…divisor.
binary('math.modulo', (a, b) => (b === 0 ? 0 : ((a % b) + b) % b));
binary('math.min', (a, b) => Math.min(a, b));
binary('math.max', (a, b) => Math.max(a, b));

// ------------------------------------------------------------------ unary

unary('math.abs', (a) => Math.abs(a));
unary('math.fract', (a) => a - Math.floor(a));
unary('math.floor', (a) => Math.floor(a));
unary('math.negate', (a) => -a);

// ---------------------------------------------------------------- blending

nary('math.mix', ['a', 'b', 't'], (a, b, t) => a + (b - a) * t);

nary('math.clamp', ['a', 'min', 'max'], (a, lo, hi) => {
  const l = Math.min(lo, hi);
  const h = Math.max(lo, hi);
  return a < l ? l : a > h ? h : a;
});

define('math.remap', (ctx, inputs) => {
  const { value, inMin, inMax, outMin, outMax } = inputs;
  const clamp = !!inputs.clamp; // toggle: a plain number, captured like the op in Trig
  const compute = (v, i0, i1, o0, o1) => {
    const span = i1 - i0;
    let t = span === 0 ? 0 : (v - i0) / span;
    if (clamp) t = t < 0 ? 0 : t > 1 ? 1 : t;
    return o0 + (o1 - o0) * t;
  };
  const fields = [value, inMin, inMax, outMin, outMax];
  if (fields.every((f) => ctx.isConstField(f))) {
    return { out: finiteOr(compute(...fields.map((f) => ctx.constValueOf(f)))) };
  }
  return {
    out: (x, y, z, fctx) =>
      finiteOr(compute(...fields.map((f) => ctx.sample(f, x, y, z, fctx, 0)))),
  };
});

nary('math.smoothstep', ['edge0', 'edge1', 'x'], (e0, e1, x, ctx) => ctx.smoothstep(e0, e1, x));

nary('math.step', ['edge', 'x'], (edge, x) => (x >= edge ? 1 : 0));

// ----------------------------------------------------------------- exotic

const TRIG = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sqrt: Math.sqrt, // NaN for negatives, guarded below
  log: Math.log, // -Infinity at 0, guarded below
  exp: Math.exp,
  sign: Math.sign,
  round: Math.round,
};

define('math.trig', (ctx, inputs) => {
  const input = inputs.input;
  const fn = TRIG[inputs.op] || Math.sin;
  const freq = Number.isFinite(Number(inputs.frequency)) ? Number(inputs.frequency) : 1;
  const offset = Number(inputs.offset) || 0;
  const shape = (v) => {
    const r = fn(v * freq + offset);
    return Number.isFinite(r) ? r : 0;
  };
  if (ctx.isConstField(input)) return { out: shape(ctx.constValueOf(input)) };
  return { out: (x, y, z, fctx) => shape(ctx.sample(input, x, y, z, fctx, 0)) };
});

// Polynomial smooth minimum — melts two shapes together organically.
nary('math.smin', ['a', 'b', 'k'], (a, b, k) => {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
});
