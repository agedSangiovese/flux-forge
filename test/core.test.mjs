/**
 * Core contract tests — run with `npm test`.
 *
 * These check the parts of the system every other module depends on: the node
 * manifest, port compatibility, value coercion, graph round-tripping and the
 * engine's evaluation / caching / dynamic-propagation behaviour. The real node
 * implementations are exercised separately by `test/nodes.test.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MANIFEST, CATEGORIES, CATEGORY_ORDER, installManifest, MANIFEST_BY_TYPE } from '../src/core/manifest.js';
import { register, getDef, hasDef, safeDef, allDefs, inputKeys } from '../src/core/registry.js';
import { accepts, PORT_TYPES, portColor } from '../src/core/portTypes.js';
import { Graph } from '../src/core/Graph.js';
import { Engine } from '../src/core/Engine.js';
import {
  coerce,
  toField,
  sample,
  hexToSRGB,
  srgbToHex,
  toColorField,
  sampleColor,
  luminance,
  isConstField,
} from '../src/core/values.js';
import { makeNoise, fbm, voronoi, hash3, makeRng } from '../src/core/noise.js';

const WIDGETS = new Set(['float', 'slider', 'int', 'toggle', 'select', 'color', 'text', 'gradient', 'curve', 'file']);

// ---------------------------------------------------------------------------
// Behavioural stand-ins for a handful of nodes. These let the engine tests
// exercise the evaluator itself rather than the node library (which has its
// own test file). Each test file runs in its own process, so this cannot leak.
// ---------------------------------------------------------------------------
installManifest();

const calls = { noise: 0, displace: 0, time: 0, sphere: 0 };

register({
  ...getDef('shape.sphere'),
  eval(ctx, inputs) {
    calls.sphere++;
    return { out: { kind: 'sphere', radius: inputs.radius, segX: inputs.segX } };
  },
});

register({
  ...getDef('geo.twist'),
  eval(ctx, inputs) {
    if (!inputs.geometry) return {};
    return { out: { ...inputs.geometry, twisted: true } };
  },
});

register({
  ...getDef('geo.displace'),
  eval(ctx, inputs) {
    calls.displace++;
    if (!inputs.geometry) {
      ctx.error('Displace needs a shape plugged into Geometry.');
      return {};
    }
    return { out: { kind: 'displaced', geo: inputs.geometry, amount: inputs.amount } };
  },
});

register({
  ...getDef('field.noise'),
  eval(ctx, inputs) {
    calls.noise++;
    return { out: (x) => x * (inputs.scale || 1) };
  },
});

register({
  ...getDef('input.time'),
  eval(ctx) {
    calls.time++;
    return { out: ctx.time };
  },
});

register({
  ...getDef('output.render'),
  eval(ctx, inputs) {
    return {
      scene: {
        object: inputs.geometry || null,
        stats: { triangles: 0, points: 0, vertices: 0 },
        exposure: inputs.exposure,
      },
    };
  },
});

// --------------------------------------------------------------- manifest

test('manifest has no duplicate type ids', () => {
  const seen = new Set();
  for (const d of MANIFEST) {
    assert.ok(!seen.has(d.type), `duplicate type "${d.type}"`);
    seen.add(d.type);
  }
  assert.ok(MANIFEST.length >= 60, `expected a rich catalogue, got ${MANIFEST.length}`);
  assert.equal(MANIFEST_BY_TYPE.size, MANIFEST.length);
});

test('every node uses a known category, port type and widget', () => {
  for (const d of MANIFEST) {
    assert.ok(CATEGORIES[d.category], `${d.type}: unknown category "${d.category}"`);
    assert.ok(CATEGORY_ORDER.includes(d.category), `${d.type}: category "${d.category}" not ordered`);
    assert.ok(d.label, `${d.type}: missing label`);
    assert.ok(d.desc, `${d.type}: missing description`);

    const keys = new Set();
    for (const i of d.inputs) {
      assert.ok(PORT_TYPES[i.type], `${d.type}.${i.key}: unknown port type "${i.type}"`);
      assert.ok(i.label, `${d.type}.${i.key}: missing label`);
      assert.ok(!keys.has(i.key), `${d.type}: duplicate input key "${i.key}"`);
      keys.add(i.key);
      if (i.widget) {
        assert.ok(WIDGETS.has(i.widget), `${d.type}.${i.key}: unknown widget "${i.widget}"`);
        assert.notEqual(i.default, undefined, `${d.type}.${i.key}: widget input needs a default`);
      }
      if (i.widget === 'select') {
        assert.ok(Array.isArray(i.options) && i.options.length, `${d.type}.${i.key}: select needs options`);
        const values = i.options.map((o) => (typeof o === 'string' ? o : o.value));
        assert.ok(
          values.includes(i.default),
          `${d.type}.${i.key}: default "${i.default}" is not one of ${values.join(', ')}`
        );
      }
      if (i.widget === 'slider' || i.widget === 'int') {
        assert.ok(Number.isFinite(i.min) && Number.isFinite(i.max), `${d.type}.${i.key}: slider needs min/max`);
        assert.ok(i.default >= i.min && i.default <= i.max, `${d.type}.${i.key}: default outside min/max`);
      }
    }

    const outKeys = new Set();
    for (const o of d.outputs) {
      assert.ok(PORT_TYPES[o.type], `${d.type}.${o.key}: unknown output type "${o.type}"`);
      assert.ok(!outKeys.has(o.key), `${d.type}: duplicate output key "${o.key}"`);
      outKeys.add(o.key);
    }
  }
});

test('there is exactly one output node per workspace and neither has outputs', () => {
  const sinks = MANIFEST.filter((d) => d.isOutput);
  assert.deepEqual(
    sinks.map((s) => s.type).sort(),
    ['output.render', 'output.shader'],
    'one 3D sink and one 2D sink'
  );
  for (const s of sinks) assert.equal(s.outputs.length, 0, `${s.type} must stay a sink`);
});

test('every output key referenced by a preset-style link target exists', () => {
  // Sanity: the render node must expose every port a graph author would wire to.
  const render = MANIFEST_BY_TYPE.get('output.render');
  for (const key of ['geometry', 'points', 'material', 'sky', 'fog', 'camera', 'lights']) {
    assert.ok(inputKeys('output.render').includes(key), `render input "${key}" missing`);
  }
  assert.ok(render);
});

// ------------------------------------------------------------ port types

test('port compatibility is symmetric for scalar/colour conversions', () => {
  assert.ok(accepts('number', 'field'));
  assert.ok(accepts('field', 'number'));
  assert.ok(accepts('color', 'number'));
  assert.ok(accepts('number', 'color'));
  assert.ok(accepts('any', 'geometry'));
  assert.ok(accepts('geometry', 'any'));

  assert.ok(!accepts('geometry', 'field'));
  assert.ok(!accepts('material', 'geometry'));
  assert.ok(!accepts('points', 'scene'));

  assert.equal(portColor('geometry'), PORT_TYPES.geometry.color);
});

// ---------------------------------------------------------------- values

test('colour strings round-trip through sRGB', () => {
  assert.deepEqual(hexToSRGB('#ff0000'), { r: 1, g: 0, b: 0 });
  assert.deepEqual(hexToSRGB('#fff'), { r: 1, g: 1, b: 1 });
  assert.equal(srgbToHex({ r: 1, g: 0.5, b: 0 }), '#ff8000');
  assert.equal(srgbToHex(hexToSRGB('#7b2ff7')), '#7b2ff7');
});

test('constants fold into tagged const fields', () => {
  const f = toField(3);
  assert.ok(isConstField(f));
  assert.equal(f.constValue, 3);
  assert.equal(sample(f, 10, 20, 30), 3);

  const c = toColorField('#ff0000');
  assert.ok(isConstField(c));
  assert.equal(sampleColor(c, 0, 0, 0).r, 1);
});

test('coercion shapes values for the receiving port', () => {
  assert.equal(coerce(5, 'number', 'number'), 5);
  assert.equal(coerce('12.5', 'number', 'number'), 12.5);
  assert.equal(coerce(undefined, 'number', 'number', 7), 7);

  // a field arriving on a number port is sampled at the origin
  const varying = (x) => x + 1;
  assert.equal(coerce(varying, 'number', 'field'), 1);

  // a constant arriving on a field port stays cheap
  const asField = coerce(4, 'field', 'number');
  assert.ok(isConstField(asField));
  assert.equal(asField(0, 0, 0), 4);

  // colours become greyscale scalars and vice versa
  const greyFromColor = coerce('#ffffff', 'number', 'color');
  assert.ok(Math.abs(greyFromColor - 1) < 1e-6);

  const colourFromScalar = coerce(coerce(0.5, 'field', 'number'), 'color', 'field');
  assert.deepEqual(sampleColor(colourFromScalar, 0, 0, 0), { r: 0.5, g: 0.5, b: 0.5 });

  // object ports pass straight through
  const geo = { fake: true };
  assert.equal(coerce(geo, 'geometry', 'geometry'), geo);
  assert.equal(coerce(undefined, 'geometry', 'geometry'), null);
});

// ------------------------------------------------------------------ graph

function buildGraph() {
  const g = new Graph();
  const sphere = g.addNode(getDef('shape.sphere'), 0, 0, { radius: 2 });
  const noise = g.addNode(getDef('field.noise'), -300, 0, { scale: 1.5 });
  const displace = g.addNode(getDef('geo.displace'), 300, 0, { amount: 0.4 });
  const material = g.addNode(getDef('material.standard'), 300, 240);
  const out = g.addNode(getDef('output.render'), 640, 80);
  return { g, sphere, noise, displace, material, out };
}

test('graph stores, connects and round-trips', () => {
  const { g, sphere, noise, displace, material, out } = buildGraph();

  assert.ok(g.connect(sphere.id, 'out', displace.id, 'geometry'));
  assert.ok(g.connect(noise.id, 'out', displace.id, 'amount'));
  assert.ok(g.connect(displace.id, 'out', out.id, 'geometry'));
  assert.ok(g.connect(material.id, 'out', out.id, 'material'));

  assert.equal(g.links.length, 4);
  assert.equal(g.incoming(displace.id, 'geometry').length, 1);

  const json = g.toJSON();
  const restored = new Graph(json);
  assert.equal(restored.nodes.length, 5);
  assert.equal(restored.links.length, 4);
  assert.equal(restored.outputNode().id, out.id);
  assert.deepEqual(restored.nodes.find((n) => n.id === sphere.id).params, { radius: 2 });
});

test('cycles are rejected and single-input ports replace their wire', () => {
  const g = new Graph();
  const a = g.addNode(getDef('geo.displace'), 0, 0);
  const b = g.addNode(getDef('geo.twist'), 200, 0);

  assert.ok(g.connect(a.id, 'out', b.id, 'geometry'));
  assert.equal(g.connect(b.id, 'out', a.id, 'geometry'), null, 'a loop must be refused');
  assert.equal(g.links.length, 1);

  const c = g.addNode(getDef('geo.bend'), 400, 0);
  g.connect(c.id, 'out', b.id, 'geometry');
  assert.equal(g.incoming(b.id, 'geometry').length, 1, 'single-input ports hold one wire');
});

test('multi-input ports accumulate', () => {
  const g = new Graph();
  const a = g.addNode(getDef('shape.box'), 0, 0);
  const b = g.addNode(getDef('shape.sphere'), 0, 200);
  const m = g.addNode(getDef('geo.merge'), 300, 100);
  g.connect(a.id, 'out', m.id, 'parts');
  g.connect(b.id, 'out', m.id, 'parts');
  assert.equal(g.incoming(m.id, 'parts').length, 2);
});

test('groups fit around their members and follow them', () => {
  const { g, sphere, displace } = buildGraph();
  const group = g.addGroup([sphere.id, displace.id], 'Sculpt');
  assert.ok(group.w > 100 && group.h > 50);

  const before = { x: group.x, y: group.y };
  sphere.x += 400;
  g.fitGroup(group);
  assert.ok(group.x !== before.x, 'group should grow to contain a moved node');
});

test('regrouping moves nodes out of their old group', () => {
  const { g, sphere, displace } = buildGraph();
  g.addGroup([sphere.id, displace.id], 'Sculpt');
  const second = g.addGroup([displace.id], 'Just Displace');

  const sculpt = g.groups.find((x) => x.title === 'Sculpt');
  assert.deepEqual(sculpt.nodes, [sphere.id], 'the old group keeps only the remaining node');
  assert.deepEqual(second.nodes, [displace.id], 'the new group owns its member');
  const owners = g.groups.filter((x) => x.nodes.includes(displace.id));
  assert.equal(owners.length, 1, 'exactly one group claims the moved node');
});

// ----------------------------------------------------------------- engine

test('engine evaluates, caches and reports', () => {
  const engine = new Engine();
  const { g, sphere, noise, displace, material, out } = buildGraph();
  g.connect(sphere.id, 'out', displace.id, 'geometry');
  g.connect(noise.id, 'out', displace.id, 'amount');
  g.connect(displace.id, 'out', out.id, 'geometry');
  g.connect(material.id, 'out', out.id, 'material');

  const first = engine.evaluate(g, { time: 0 });
  assert.ok(first.scene, 'a wired graph must produce a scene');
  assert.equal(first.errors.size, 0, [...first.errors.values()].join('; '));
  assert.equal(first.evaluated, 5);
  assert.equal(first.cached, 0);

  const second = engine.evaluate(g, { time: 0 });
  assert.equal(second.cached, 5, 'unchanged structure should be served from cache');
  assert.equal(second.scene, first.scene, 'the cached scene object is reused');
  assert.equal(second.changed, false);

  // Touch a parameter: the owning node and everything downstream must re-run,
  // while untouched branches stay cached.
  g.setParam(displace.id, 'amount', 0.9);
  const third = engine.evaluate(g, { time: 0 });
  assert.equal(third.changed, true, 'a new scene object must be handed to the renderer');
  assert.equal(third.evaluated, 2, 'displace + output re-run; the rest is cached');
  assert.equal(third.cached, 3);
  assert.notEqual(third.scene, first.scene);
});

test('engine reports missing outputs and node errors', () => {
  const engine = new Engine();

  const empty = new Graph();
  const noOutput = engine.evaluate(empty, {});
  assert.equal(noOutput.scene, null);
  assert.equal(noOutput.reason, 'no-output');

  const g = new Graph();
  const displace = g.addNode(getDef('geo.displace'), 0, 0);
  const out = g.addNode(getDef('output.render'), 300, 0);
  g.connect(displace.id, 'out', out.id, 'geometry');

  const res = engine.evaluate(g, {});
  assert.ok(res.scene, 'the render node still produces a scene spec');
  assert.equal(res.scene.object, null, 'but there is nothing to draw');
  assert.ok(
    [...res.errors.values()].some((m) => /shape/i.test(m)),
    `expected a friendly message, got: ${[...res.errors.values()].join('; ')}`
  );
});

test('time-dependent branches are never cached', () => {
  const engine = new Engine();
  calls.time = 0;

  const g = new Graph();
  const time = g.addNode(getDef('input.time'), 0, 0);
  const sphere = g.addNode(getDef('shape.sphere'), 0, 200);
  const out = g.addNode(getDef('output.render'), 300, 0);
  g.connect(time.id, 'out', out.id, 'exposure');
  g.connect(sphere.id, 'out', out.id, 'geometry');

  const a = engine.evaluate(g, { time: 1 });
  // The time node and the render node that reads it are both dynamic; the
  // sphere is not.
  assert.equal(a.dynamicCount, 2, 'only nodes downstream of Time re-run');
  assert.equal(calls.time, 1);

  const b = engine.evaluate(g, { time: 2 });
  assert.equal(b.dynamicCount, 2);
  assert.equal(calls.time, 2, 'the dynamic node must re-run every frame');
  assert.ok(b.cached >= 1, 'static branches stay cached');
  assert.ok(b.evaluated >= 1);
});

test('bypass routes the selected input straight through', () => {
  const engine = new Engine();
  const g = new Graph();
  const sphere = g.addNode(getDef('shape.sphere'), 0, 0, { radius: 9 });
  const twist = g.addNode(getDef('geo.twist'), 300, 0);
  const out = g.addNode(getDef('output.render'), 600, 0);
  g.connect(sphere.id, 'out', twist.id, 'geometry');
  g.connect(twist.id, 'out', out.id, 'geometry');

  const active = engine.evaluate(g, {});
  assert.equal(active.scene.object.radius, 9);
  assert.equal(active.scene.object.twisted, true, 'the twist applies normally');

  g.getNode(twist.id).bypass = true;
  const bypassed = engine.evaluate(g, {});
  assert.equal(bypassed.scene.object.radius, 9, 'bypassed node passes geometry through untouched');
  assert.equal(bypassed.scene.object.twisted, undefined, 'and its own effect is skipped');
});

// ------------------------------------------------------------------ noise

test('noise is deterministic, seeded and roughly zero-centred', () => {
  const a = makeNoise(7);
  const b = makeNoise(7);
  const c = makeNoise(8);

  assert.equal(a(1.2, 3.4, 5.6), b(1.2, 3.4, 5.6), 'same seed must match exactly');
  assert.notEqual(a(1.2, 3.4, 5.6), c(1.2, 3.4, 5.6), 'different seeds must differ');

  let sum = 0;
  let peak = 0;
  const rng = makeRng(3);
  for (let i = 0; i < 4000; i++) {
    const v = a(rng() * 40, rng() * 40, rng() * 40);
    sum += v;
    peak = Math.max(peak, Math.abs(v));
  }
  assert.ok(Math.abs(sum / 4000) < 0.05, `noise should be zero-centred, got ${sum / 4000}`);
  assert.ok(peak < 2, `noise should stay bounded, peak ${peak}`);
});

test('fractal and cellular variants behave', () => {
  const n = makeNoise(1);
  const smooth = fbm(n, 3.3, 1.1, 0.7, { scale: 1, octaves: 5 });
  const ridged = fbm(n, 3.3, 1.1, 0.7, { scale: 1, octaves: 5, mode: 'ridged' });
  const billow = fbm(n, 3.3, 1.1, 0.7, { scale: 1, octaves: 5, mode: 'billow' });
  const white = fbm(n, 3.3, 1.1, 0.7, { scale: 4, mode: 'white' });

  for (const v of [smooth, ridged, billow, white]) assert.ok(Number.isFinite(v));
  assert.ok(white >= 0 && white <= 1, 'white noise is 0..1');
  assert.ok(smooth !== ridged, 'character modes must differ');

  const v1 = voronoi(0.4, 0.9, 1.7, { scale: 3, seed: 2 });
  const v2 = voronoi(0.4, 0.9, 1.7, { scale: 3, seed: 2 });
  assert.deepEqual(v1, v2, 'voronoi must be deterministic');
  assert.ok(v1.f2 >= v1.f1, 'F2 is always at least F1');
  assert.ok(v1.id >= 0 && v1.id < 1);
  assert.equal(hash3(4, 5, 6, 1), hash3(4, 5, 6, 1));
});
