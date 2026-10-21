/**
 * Animation tests — keyframe curves and 4-D noise — run with `npm test`.
 *
 * Covers the pure curve math (src/core/curves.js), the 4-D sampler
 * (src/core/noise.js: determinism, W-continuity, W-decorrelation, range) and
 * the two nodes that use them through the engine, ending with the full
 * keyframes → noise4.w → geometry pipeline.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normKeys, sampleCurve, evalCurve, keyRange, KEY_DEFAULTS } from '../src/core/curves.js';
import { makeNoise, makeNoise4, fbm } from '../src/core/noise.js';
import { MANIFEST } from '../src/core/manifest.js';
import { Graph } from '../src/core/Graph.js';
import { Engine } from '../src/core/Engine.js';
import { getDef } from '../src/core/registry.js';
import { installNodes } from '../src/nodes/index.js';

/** Build a graph from [type, params, id?] specs plus link tuples. */
function build(specs, links = []) {
  const g = new Graph();
  const nodes = specs.map(([type, params, id], i) =>
    g.addNode(getDef(type), i * 240, 0, params || {}, id ? { id } : {})
  );
  for (const [a, ap, b, bp] of links) {
    assert.ok(g.connect(nodes[a].id, ap, nodes[b].id, bp), `link ${a}.${ap} -> ${b}.${bp} must connect`);
  }
  return { g, nodes };
}

/** The first mesh inside an artwork scene, or null. */
function firstMesh(scene) {
  let found = null;
  scene.object.traverse((o) => {
    if (!found && o.isMesh) found = o;
  });
  return found;
}

// ------------------------------------------------------------- curve math

test('normKeys sorts, sanitizes and copies', () => {
  const raw = [
    { t: 2, v: 1, ease: 'smooth' },
    { t: -1, v: 0.5, ease: 'bogus' },
    { t: 'x', v: 1 },
    null,
  ];
  const keys = normKeys(raw);
  assert.equal(keys.length, 2, 'invalid entries are dropped');
  assert.equal(keys[0].t, 0, 'negative times clamp to zero');
  assert.equal(keys[0].ease, 'linear', 'an unknown ease falls back to linear');
  assert.equal(keys[1].t, 2);
  assert.equal(keys[1].ease, 'smooth');
  raw[0].v = 99;
  assert.equal(keys[1].v, 1, 'must copy — never alias the input list');
  assert.deepEqual(normKeys(null), KEY_DEFAULTS, 'garbage falls back to the defaults');
  assert.notEqual(normKeys(null), KEY_DEFAULTS, 'and the defaults are copied, not shared');
});

test('curve eases: hold steps, linear is straight, smooth eases', () => {
  const lin = normKeys([
    { t: 0, v: 0, ease: 'linear' },
    { t: 1, v: 10, ease: 'linear' },
  ]);
  assert.equal(sampleCurve(lin, 0.5), 5);
  const sm = normKeys([
    { t: 0, v: 0, ease: 'smooth' },
    { t: 1, v: 10, ease: 'smooth' },
  ]);
  assert.equal(sampleCurve(sm, 0.5), 5, 'smoothstep passes through its midpoint');
  assert.equal(sampleCurve(sm, 0.25), 1.5625, 'and eases between them');
  const hd = normKeys([
    { t: 0, v: 0, ease: 'hold' },
    { t: 1, v: 10, ease: 'hold' },
  ]);
  assert.equal(sampleCurve(hd, 0.99), 0, 'hold stays put until the next key');
  assert.equal(sampleCurve(hd, 1), 10);
  assert.equal(sampleCurve(lin, -5), 0, 'before the first key holds flat');
  assert.equal(sampleCurve(lin, 99), 10, 'after the last key holds flat');
});

test('evalCurve wraps the clock per loop mode', () => {
  const keys = KEY_DEFAULTS; // 0 → 1 over 0…2s, smooth
  assert.equal(evalCurve(keys, 0, 'pingpong'), 0);
  assert.equal(evalCurve(keys, 1, 'pingpong'), 0.5);
  assert.equal(evalCurve(keys, 2, 'pingpong'), 1);
  assert.equal(evalCurve(keys, 3, 'pingpong'), 0.5, 'ping-pong runs back down');
  assert.equal(evalCurve(keys, 4, 'pingpong'), 0, 'a full cycle returns to the start');
  assert.equal(evalCurve(keys, 6, 'pingpong'), 1);
  assert.equal(evalCurve(keys, 2.5, 'loop'), evalCurve(keys, 0.5, 'loop'), 'loop repeats the span');
  assert.equal(evalCurve(keys, 2.5, 'loop'), 0.15625);
  assert.equal(evalCurve(keys, 9, 'hold'), 1, 'hold freezes on the last value');
  assert.equal(evalCurve(keys, -3, 'hold'), 0, 'before the start holds the first key');
  assert.equal(evalCurve(keys, 1, 'nonsense'), evalCurve(keys, 1, 'hold'), 'a bad mode holds');
  assert.equal(evalCurve(null, 1, 'pingpong'), evalCurve(KEY_DEFAULTS, 1, 'pingpong'));
});

test('keyRange pads around the keys', () => {
  const { lo, hi } = keyRange(normKeys(KEY_DEFAULTS));
  assert.ok(lo < 0 && hi > 1, 'the domain leaves headroom');
  assert.ok(Math.abs(lo + 0.18) < 1e-12 && Math.abs(hi - 1.18) < 1e-12, '18% of the spread each side');
  const flat = keyRange(normKeys([{ t: 0, v: 3 }, { t: 1, v: 3 }]));
  assert.ok(flat.lo < 3 && flat.hi > 3, 'a flat curve still gets a visible band');
});

// ------------------------------------------------------------- 4-D noise

test('4-D noise is deterministic per seed', () => {
  const a = makeNoise4(12);
  const b = makeNoise4(12);
  const c = makeNoise4(13);
  let differs = false;
  for (let i = 0; i < 500; i++) {
    const x = i * 0.37;
    const y = i * 0.91;
    const z = i * 0.53;
    const w = i * 0.29;
    const va = a(x, y, z, w);
    assert.equal(va, b(x, y, z, w), 'same seed must repeat exactly');
    if (Math.abs(va - c(x, y, z, w)) > 1e-9) differs = true;
  }
  assert.ok(differs, 'a different seed must give different noise');
});

test('4-D noise stays inside the 3-D envelope', () => {
  const n = makeNoise4(4);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const v = n(i * 0.113, i * 0.271, i * 0.197, i * 0.149);
    assert.ok(Number.isFinite(v), `sample ${i} must be finite`);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  assert.ok(min > -1.05 && max < 1.05, `range [${min.toFixed(3)}, ${max.toFixed(3)}] must match the 3-D sampler`);
});

test('W is continuous — tiny steps give tiny deltas', () => {
  const n = makeNoise4(2);
  for (let i = 0; i < 3000; i++) {
    const w = i * 0.017;
    const d = Math.abs(n(1.7, 2.3, 0.9, w) - n(1.7, 2.3, 0.9, w + 0.001));
    assert.ok(d < 0.05, `delta ${d} at w=${w} must be tiny`);
  }
});

test('W decorrelates — distant slices are unrelated', () => {
  const n = makeNoise4(5);
  let sum = 0;
  const count = 4000;
  for (let i = 0; i < count; i++) {
    sum += Math.abs(n(i * 0.13, i * 0.29, i * 0.07, 0) - n(i * 0.13, i * 0.29, i * 0.07, 5));
  }
  assert.ok(sum / count > 0.15, `mean |Δ| = ${(sum / count).toFixed(3)} must show real change over Δw=5`);
});

test('fbm passes W to 4-D samplers and leaves 3-D ones alone', () => {
  const opts = { scale: 0.6, octaves: 4, persistence: 0.5, lacunarity: 2, mode: 'smooth', seed: 3 };
  const n3 = makeNoise(3);
  for (let i = 0; i < 50; i++) {
    const x = i * 0.31;
    const y = i * 0.17;
    const z = i * 0.23;
    assert.equal(fbm(n3, x, y, z, opts), fbm(n3, x, y, z, { ...opts, w: 7 }), 'a 3-D sampler ignores W');
  }
  const n4 = makeNoise4(3);
  let changed = false;
  for (let i = 0; i < 50; i++) {
    const x = i * 0.31;
    const y = i * 0.17;
    const z = i * 0.23;
    const a = fbm(n4, x, y, z, { ...opts, w: 0 });
    const b = fbm(n4, x, y, z, { ...opts, w: 2 });
    assert.ok(Number.isFinite(a) && Number.isFinite(b));
    if (Math.abs(a - b) > 1e-6) changed = true;
  }
  assert.ok(changed, 'W must change a 4-D fbm');
});

// ------------------------------------------------------- engine integration

test('the animation nodes declare themselves', () => {
  assert.ok(installNodes(), 'every manifest node must be implemented');
  const kf = MANIFEST.find((d) => d.type === 'input.keyframes');
  const n4 = MANIFEST.find((d) => d.type === 'field.noise4');
  assert.ok(kf && n4, 'both nodes must be in the manifest');
  assert.equal(kf.dynamic, true, 'keyframes must re-evaluate every frame');
  assert.equal(n4.category, 'field');
  assert.ok(kf.inputs.some((i) => i.key === 'time' && !i.widget), 'Time stays a bare socket');
  assert.ok(kf.inputs.some((i) => i.widget === 'curve'), 'the curve widget drives the keys');
  assert.ok(n4.inputs.some((i) => i.key === 'w'), 'W must be a wireable input');
});

test('keyframes follows the playback clock', () => {
  const { g } = build(
    [
      ['input.keyframes', {}, 'kf'],
      ['shape.plane', {}, 'plane'],
      ['output.render', {}, 'out'],
    ],
    [
      [0, 'out', 2, 'exposure'],
      [1, 'out', 2, 'geometry'],
    ]
  );
  const engine = new Engine();
  const first = engine.evaluate(g, { time: 0 });
  assert.equal(first.errors.size, 0, [...first.errors.values()].join('; '));
  assert.ok(first.dynamicCount > 0, 'keyframes must mark its branch dynamic');
  const at = (t) => engine.evaluate(g, { time: t }).scene.exposure;
  assert.equal(at(0), 0);
  assert.equal(at(1), 0.5);
  assert.equal(at(2), 1);
  assert.equal(at(3), 0.5);
  assert.equal(at(4), 0, 'ping-pong is the default: a cycle returns to the start');
  assert.equal(at(6), 1);
});

test('a wired Time input takes over the clock', () => {
  const { g } = build(
    [
      ['input.number', { value: 0.5 }, 'clock'],
      ['input.keyframes', {}, 'kf'],
      ['shape.plane', {}, 'plane'],
      ['output.render', {}, 'out'],
    ],
    [
      [0, 'out', 1, 'time'],
      [1, 'out', 3, 'exposure'],
      [2, 'out', 3, 'geometry'],
    ]
  );
  const engine = new Engine();
  const a = engine.evaluate(g, { time: 0 });
  const b = engine.evaluate(g, { time: 7 });
  assert.equal(a.errors.size, 0, [...a.errors.values()].join('; '));
  assert.equal(a.scene.exposure, b.scene.exposure, 'playback time must be ignored while Time is wired');
  assert.equal(a.scene.exposure, 0.15625, 'the curve is sampled at the wired value');
});

test('loop modes pick the wrap', () => {
  const at = (params, t) => {
    const { g } = build(
      [
        ['input.keyframes', params, 'kf'],
        ['output.render', {}, 'out'],
      ],
      [[0, 'out', 1, 'exposure']]
    );
    return new Engine().evaluate(g, { time: t }).scene.exposure;
  };
  assert.equal(at({ loop: 'loop' }, 2.5), 0.15625, 'loop repeats from the start');
  assert.equal(at({ loop: 'loop' }, 2.5), at({ loop: 'loop' }, 0.5));
  assert.equal(at({ loop: 'hold' }, 9), 1, 'hold freezes on the last value');
});

test('saved key lists drive the output', () => {
  const keys = [
    { t: 0, v: 0, ease: 'linear' },
    { t: 1, v: 1, ease: 'linear' },
  ];
  const { g } = build(
    [
      ['input.keyframes', { keys, loop: 'hold' }, 'kf'],
      ['shape.plane', {}, 'plane'],
      ['output.render', {}, 'out'],
    ],
    [
      [0, 'out', 2, 'exposure'],
      [1, 'out', 2, 'geometry'],
    ]
  );
  const res = new Engine().evaluate(g, { time: 0.5 });
  assert.equal(res.errors.size, 0, [...res.errors.values()].join('; '));
  assert.equal(res.scene.exposure, 0.5, 'a saved straight-line curve must sample linearly');
});

test('keyframes morphs a 4-D noise field into geometry', () => {
  const { g } = build(
    [
      ['input.keyframes', {}, 'kf'],
      ['field.noise4', { scale: 3 }, 'n4'],
      ['shape.plane', {}, 'plane'],
      ['geo.displace', {}, 'disp'],
      ['material.standard', {}, 'mat'],
      ['output.render', {}, 'out'],
    ],
    [
      [0, 'out', 1, 'w'],
      [1, 'out', 3, 'amount'],
      [2, 'out', 3, 'geometry'],
      [3, 'out', 5, 'geometry'],
      [4, 'out', 5, 'material'],
    ]
  );
  const engine = new Engine();
  const grab = (t) => {
    const res = engine.evaluate(g, { time: t });
    assert.equal(res.errors.size, 0, [...res.errors.values()].join('; '));
    return Array.from(firstMesh(res.scene).geometry.getAttribute('position').array);
  };
  const w0 = grab(0);
  assert.deepEqual(grab(0), w0, 'the same time must give the same geometry');
  const w2 = grab(2);
  let differs = false;
  for (let i = 0; i < w0.length; i++) {
    if (Math.abs(w0[i] - w2[i]) > 1e-6) differs = true;
  }
  assert.ok(differs, 'the W axis must morph the pattern in place');
});
