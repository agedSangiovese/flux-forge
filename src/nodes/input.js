/**
 * Input nodes — constants, time and the humble sticky note.
 *
 * These are the entry points of a graph: everything else is derived from a
 * number, a seed or the playback clock.
 */
import { define } from './define.js';
import { evalCurve } from '../core/curves.js';

define('input.number', (ctx, inputs) => ({
  out: Number.isFinite(Number(inputs.value)) ? Number(inputs.value) : 0,
}));

// Time and Keyframes are the catalogue's dynamic nodes: while the animation
// plays, every branch downstream of them re-evaluates every frame.
define(
  'input.time',
  (ctx, inputs) => ({
    out: (Number(inputs.offset) || 0) + ctx.time * (Number(inputs.speed) || 0),
  }),
  { dynamic: true }
);

// A curve of value over time. Unwired, Time follows the playback clock;
// wired, it follows whatever source is plugged in instead.
define(
  'input.keyframes',
  (ctx, inputs) => {
    const wired = ctx.graph.incoming(ctx.node.id, 'time').length > 0;
    const t = wired ? Number(inputs.time) || 0 : ctx.time;
    return { out: evalCurve(inputs.keys, t, inputs.loop) };
  },
  { dynamic: true }
);

define('input.seed', (ctx, inputs) => ({
  out: Math.max(0, Math.round(Number(inputs.value) || 0)),
}));

// A sticky note does not produce anything — it exists so you can annotate a
// graph without breaking the evaluation.
define('util.note', () => ({}));
