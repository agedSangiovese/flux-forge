/**
 * Keyframe curve math — shared by the `input.keyframes` node and its editor
 * widget, so the curve you draw in the widget is exactly the number the
 * engine samples at runtime.
 *
 * A curve is a list of keys sorted by time: `{ t, v, ease }` where
 *
 *   t     — time in seconds, always >= 0
 *   v     — the value at that key
 *   ease  — how the curve *leaves* this key on its way to the next one:
 *           'hold'   stay at this value until the next key (a step)
 *           'linear' straight line
 *           'smooth' smoothstep — the friendly default, no velocity kinks
 *
 * Playback wraps the clock before sampling ('hold' clamps to the first/last
 * key, 'loop' jumps back when the end is passed, 'pingpong' runs forward then
 * backward forever). Nothing here mutates its inputs.
 */

export const KEY_EASES = ['hold', 'linear', 'smooth'];
export const LOOP_MODES = ['hold', 'loop', 'pingpong'];

/** Two keys, 0 -> 1 over two seconds: the shape W-axis morphing wants. */
export const KEY_DEFAULTS = [
  { t: 0, v: 0, ease: 'smooth' },
  { t: 2, v: 1, ease: 'smooth' },
];

const mod = (x, m) => ((x % m) + m) % m;

const easeOf = (kind, u) =>
  kind === 'hold' ? (u >= 1 ? 1 : 0) : kind === 'smooth' ? u * u * (3 - 2 * u) : u;

/**
 * Coerce whatever arrived — widget edits, a saved doc, hand-written JSON —
 * into a sorted, safe key list of fresh objects. Falls back to `fallback`
 * (then the built-in defaults) when nothing usable is left.
 */
export function normKeys(value, fallback = KEY_DEFAULTS) {
  const parse = (src) => {
    if (!Array.isArray(src)) return null;
    const keys = [];
    for (const k of src) {
      if (!k || typeof k !== 'object') continue;
      const t = Number(k.t);
      const v = Number(k.v);
      if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
      keys.push({
        t: Math.max(0, t),
        v,
        ease: KEY_EASES.includes(k.ease) ? k.ease : 'linear',
      });
    }
    keys.sort((a, b) => a.t - b.t);
    return keys.length ? keys : null;
  };
  return parse(value) || parse(fallback) || KEY_DEFAULTS.map((k) => ({ ...k }));
}

/**
 * Sample the raw curve at `t` seconds: flat before the first key and after
 * the last (no wrapping — that is evalCurve's job). Keys must be sorted.
 */
export function sampleCurve(keys, t) {
  const n = keys.length;
  if (!n) return 0;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[n - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t > b.t) continue;
    const span = b.t - a.t;
    const u = span <= 1e-9 ? 1 : (t - a.t) / span;
    return a.v + (b.v - a.v) * easeOf(a.ease, u);
  }
  return last.v;
}

/**
 * Sample the curve at playback time `t`, wrapping the clock per `loop`.
 * Anything not 'loop'/'pingpong' (including a bad wired value) holds.
 */
export function evalCurve(value, t, loop = 'pingpong') {
  const keys = normKeys(value);
  const time = Number.isFinite(t) ? t : 0;
  if (keys.length === 1) return keys[0].v;
  const t0 = keys[0].t;
  const t1 = keys[keys.length - 1].t;
  const span = t1 - t0;
  let tc = time;
  if (span <= 1e-9) tc = t0;
  else if (loop === 'loop') tc = t0 + mod(time - t0, span);
  else if (loop === 'pingpong') {
    const u = mod(time - t0, span * 2);
    tc = t0 + (u <= span ? u : span * 2 - u);
  } else tc = Math.min(Math.max(time, t0), t1); // hold
  return sampleCurve(keys, tc);
}

/**
 * Value domain for the plot: `[lo, hi]` around the keys with `pad` headroom
 * (fraction of the spread) so handles never sit on the border.
 */
export function keyRange(keys, pad = 0.18) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of keys) {
    if (k.v < lo) lo = k.v;
    if (k.v > hi) hi = k.v;
  }
  if (!Number.isFinite(lo)) return { lo: -1, hi: 1 };
  if (hi - lo < 1e-6) return { lo: lo - 1, hi: hi + 1 };
  const grow = (hi - lo) * pad;
  return { lo: lo - grow, hi: hi + grow };
}
