/**
 * Node library tests — run with `npm test`.
 *
 * test/core.test.mjs stubs a handful of nodes to test the *engine* in
 * isolation. This file tests the real implementations: every manifest entry
 * must be implemented, schemas must match the manifest, and representative
 * graphs must produce sane geometry, points, materials and scenes — including
 * every shipped preset as a full-library integration test.
 *
 * NOTE: do not call installManifest() here. ES imports are hoisted, so the
 * node library registers its real implementations first; re-registering the
 * manifest's schema-only entries afterwards would clobber every `eval`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MANIFEST } from '../src/core/manifest.js';
import { getDef, hasDef } from '../src/core/registry.js';
import { Graph } from '../src/core/Graph.js';
import { Engine } from '../src/core/Engine.js';
import { installNodes } from '../src/nodes/index.js';
import { PRESETS } from '../src/presets/index.js';

/** Evaluate a graph and assert nothing went wrong; returns the result. */
function evalOk(graph, options = {}) {
  const engine = new Engine();
  const res = engine.evaluate(graph, options);
  assert.equal(
    res.errors.size,
    0,
    `unexpected errors:\n  ${[...res.errors.values()].join('\n  ')}`
  );
  assert.ok(res.scene, 'the graph must produce a scene');
  return res;
}

/**
 * Build a graph from [type, params, id?] specs plus [fromIdx, fromPort, toIdx, toPort]
 * links. Supplying explicit ids matters for any test that compares two
 * separately-built graphs: the engine derives each node's RNG/noise seed from
 * its id, so random ids would make identical graphs behave differently.
 */
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

/** The first mesh inside an artwork group, or null. */
function firstMesh(scene) {
  let found = null;
  scene.object.traverse((o) => {
    if (!found && o.isMesh) found = o;
  });
  return found;
}

/** The first THREE.Points inside an artwork group, or null. */
function firstPoints(scene) {
  let found = null;
  scene.object.traverse((o) => {
    if (!found && o.isPoints) found = o;
  });
  return found;
}

// ------------------------------------------------- installation & schema

test('every manifest node is implemented', () => {
  const complete = installNodes();
  const missing = MANIFEST.filter((d) => !hasDef(d.type)).map((d) => d.type);
  assert.deepEqual(missing, [], `unimplemented nodes: ${missing.join(', ')}`);
  assert.equal(complete, true);
});

test('implemented schemas match the manifest exactly', () => {
  installNodes();
  for (const d of MANIFEST) {
    const impl = getDef(d.type);
    assert.equal(impl.type, d.type);
    assert.deepEqual(
      impl.inputs.map((i) => i.key),
      d.inputs.map((i) => i.key),
      `${d.type}: input keys drifted from the manifest`
    );
    assert.deepEqual(
      impl.outputs.map((o) => o.key),
      d.outputs.map((o) => o.key),
      `${d.type}: output keys drifted from the manifest`
    );
    assert.equal(typeof impl.eval, 'function', `${d.type}: missing eval`);
  }
});

// ----------------------------------------------------------------- shapes

test('shapes build real geometry and render end to end', () => {
  const shapes = MANIFEST.filter((d) => d.category === 'shape').map((d) => d.type);
  assert.ok(shapes.length >= 8, `expected a decent shape family, got ${shapes.length}`);

  for (const type of shapes) {
    const { g } = build([[type], ['output.render']], [[0, 'out', 1, 'geometry']]);
    const res = evalOk(g);
    const mesh = firstMesh(res.scene);
    assert.ok(mesh, `${type}: the render node must produce a mesh`);
    const pos = mesh.geometry.getAttribute('position');
    assert.ok(pos && pos.count > 0, `${type}: geometry must have vertices`);
    assert.ok(res.scene.stats.triangles > 0, `${type}: stats must count triangles`);
    assert.equal(res.scene.object.name, 'artwork', 'the artwork group must be named for glTF export');
    // A wild knob must never produce NaN coordinates.
    for (let i = 0; i < Math.min(pos.count * 3, 300); i++) {
      assert.ok(Number.isFinite(pos.array[i]), `${type}: non-finite vertex coordinate`);
    }
  }
});

test('shape params override manifest defaults', () => {
  const { g } = build(
    [['shape.sphere', { radius: 3 }], ['output.render']],
    [[0, 'out', 1, 'geometry']]
  );
  const res = evalOk(g);
  const pos = firstMesh(res.scene).geometry.getAttribute('position');
  let maxR = 0;
  for (let i = 0; i < pos.count; i++) {
    maxR = Math.max(maxR, Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  assert.ok(Math.abs(maxR - 3) < 0.01, `expected radius 3, got ${maxR}`);
});

// --------------------------------------------------------------- deformers

test('deformers produce geometry without errors', () => {
  for (const type of ['geo.displace', 'geo.twist', 'geo.bend', 'geo.transform', 'geo.refine']) {
    const { g } = build(
      [
        ['shape.plane', { segX: 24, segY: 24 }],
        [type],
        ['output.render'],
      ],
      [
        [0, 'out', 1, 'geometry'],
        [1, 'out', 2, 'geometry'],
      ]
    );
    const res = evalOk(g);
    const pos = firstMesh(res.scene).geometry.getAttribute('position');
    assert.ok(pos.count > 0, `${type}: must produce geometry`);
    for (let i = 0; i < Math.min(pos.count * 3, 120); i++) {
      assert.ok(Number.isFinite(pos.array[i]), `${type}: non-finite coordinate`);
    }
  }
});

test('displace with a noise field actually deforms the surface', () => {
  const { g } = build(
    [
      ['shape.plane', { segX: 16, segY: 16 }],
      ['field.noise', { scale: 1.5 }],
      ['geo.displace', { amount: 0.8 }],
      ['output.render'],
    ],
    [
      [0, 'out', 2, 'geometry'],
      [1, 'out', 2, 'amount'],
      [2, 'out', 3, 'geometry'],
    ]
  );
  const res = evalOk(g);
  const pos = firstMesh(res.scene).geometry.getAttribute('position');
  // The plane starts flat at z=0; displaced vertices must leave that plane.
  let moved = 0;
  for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i)) > 1e-6) moved++;
  assert.ok(moved > pos.count * 0.5, `expected most vertices displaced, got ${moved}/${pos.count}`);
});

test('merge combines both inputs', () => {
  const merged = build(
    [['shape.box'], ['shape.sphere'], ['geo.merge'], ['output.render']],
    [
      [0, 'out', 2, 'parts'],
      [1, 'out', 2, 'parts'],
      [2, 'out', 3, 'geometry'],
    ]
  );
  const box = build([['shape.box'], ['output.render']], [[0, 'out', 1, 'geometry']]);
  const sphere = build([['shape.sphere'], ['output.render']], [[0, 'out', 1, 'geometry']]);

  const m = evalOk(merged.g).scene;
  const b = evalOk(box.g).scene;
  const s = evalOk(sphere.g).scene;
  // Triangle count survives de-indexing, so it is the robust invariant here.
  assert.equal(
    m.stats.triangles,
    b.stats.triangles + s.stats.triangles,
    'the merged mesh must contain every triangle of both parts'
  );
  assert.ok(m.stats.triangles > b.stats.triangles);
});

// ----------------------------------------------------------------- fields

test('field nodes evaluate to finite values through the engine', () => {
  const fieldTypes = MANIFEST.filter((d) => d.category === 'field').map((d) => d.type);
  assert.ok(fieldTypes.length >= 7, `expected a rich field family, got ${fieldTypes.length}`);

  for (const type of fieldTypes) {
    const { g } = build(
      [[type], ['shape.plane', { segX: 2, segY: 2 }], ['output.render']],
      [
        [0, 'out', 2, 'exposure'], // coerced to a number by sampling the field
        [1, 'out', 2, 'geometry'],
      ]
    );
    const res = evalOk(g, { time: 0 });
    assert.ok(Number.isFinite(res.scene.exposure), `${type}: exposure sample must be finite`);
  }
});

test('noise fields honour the seed and vary across space', () => {
  const make = (seed) =>
    build(
      [
        ['shape.box', { seg: 8 }, 'box'],
        ['field.noise', { seed, scale: 2 }, 'noise'],
        ['geo.displace', { amount: 1 }, 'displace'],
        ['output.render', {}, 'out'],
      ],
      [
        [0, 'out', 2, 'geometry'],
        [1, 'out', 2, 'amount'],
        [2, 'out', 3, 'geometry'],
      ]
    ).g;

  const pa = Array.from(firstMesh(evalOk(make(7)).scene).geometry.getAttribute('position').array);
  const pb = Array.from(firstMesh(evalOk(make(7)).scene).geometry.getAttribute('position').array);
  const pc = Array.from(firstMesh(evalOk(make(99)).scene).geometry.getAttribute('position').array);

  assert.deepEqual(pa.slice(0, 200), pb.slice(0, 200), 'same seed must reproduce exactly');
  let differs = false;
  for (let i = 0; i < Math.min(pa.length, 300); i++) {
    if (Math.abs(pa[i] - pc[i]) > 1e-6) { differs = true; break; }
  }
  assert.ok(differs, 'a different seed must give a different landscape');
});

// --------------------------------------------------------------- materials

test('material nodes produce descriptors without errors', () => {
  const materialTypes = MANIFEST.filter((d) => d.category === 'material').map((d) => d.type);
  assert.ok(materialTypes.length >= 5);
  for (const type of materialTypes) {
    const { g, nodes } = build([[type], ['output.render']], [[0, 'out', 1, 'material']]);
    // No geometry: the render node reports its own friendly message, so we
    // only assert the material node itself did not throw.
    const engine = new Engine();
    const res = engine.evaluate(g, {});
    assert.ok(!res.errors.has(nodes[0].id), `${type} threw: ${res.errors.get(nodes[0].id)}`);
  }
});

test('a colour field bakes vertex colours onto the mesh', () => {
  const { g } = build(
    [
      ['shape.sphere', { segX: 24, segY: 16 }],
      ['field.noise', { scale: 1 }],
      ['color.ramp', {}],
      ['material.standard', {}],
      ['output.render'],
    ],
    [
      [0, 'out', 3, 'geometry'],
      [1, 'out', 2, 'value'],
      [2, 'out', 3, 'color'],
      [3, 'out', 4, 'material'],
      [0, 'out', 4, 'geometry'],
    ]
  );
  const res = evalOk(g);
  assert.ok(
    firstMesh(res.scene).geometry.getAttribute('color'),
    'a varying colour must be baked into vertex colours'
  );
});

// ----------------------------------------------------------------- points

test('scatter turns a shape into a particle cloud', () => {
  const { g } = build(
    [
      ['shape.sphere', { radius: 1, segX: 24, segY: 16 }],
      ['points.scatter', { count: 500 }],
      ['output.render'],
    ],
    [
      [0, 'out', 1, 'geometry'],
      [1, 'out', 2, 'points'],
    ]
  );
  const res = evalOk(g);
  assert.equal(res.scene.stats.points, 500);
  assert.equal(res.scene.stats.triangles, 0, 'a points-only graph reports no triangles');
  const points = firstPoints(res.scene);
  assert.ok(points, 'the artwork must contain a THREE.Points');
  const pos = points.geometry.getAttribute('position');
  assert.equal(pos.count, 500);
  // Points sampled from a unit sphere must sit on its surface.
  for (let i = 0; i < 50; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    assert.ok(Math.abs(r - 1) < 0.05, `expected the sphere surface, got radius ${r}`);
  }
});

test('scatter is deterministic for a seed', () => {
  const make = () =>
    build(
      [
        ['shape.ico', { detail: 2 }, 'ico'],
        ['points.scatter', { count: 200, seed: 42 }, 'scatter'],
        ['output.render', {}, 'out'],
      ],
      [
        [0, 'out', 1, 'geometry'],
        [1, 'out', 2, 'points'],
      ]
    ).g;
  const grab = (g) =>
    Array.from(firstPoints(evalOk(g).scene).geometry.getAttribute('position').array.slice(0, 60));
  assert.deepEqual(grab(make()), grab(make()));
});

// ------------------------------------------------------------ time & cache

test('time drives its dependents', () => {
  const { g } = build(
    [
      ['input.time', {}, 'time'],
      ['math.remap', {}, 'remap'],
      ['output.render', {}, 'out'],
    ],
    [
      [0, 'out', 1, 'value'],
      [1, 'out', 2, 'exposure'],
    ]
  );
  const engine = new Engine();
  const a = engine.evaluate(g, { time: 0 });
  const b = engine.evaluate(g, { time: 1 });
  assert.ok(a.dynamicCount > 0, 'time must mark its branch dynamic');
  assert.ok(b.dynamicCount > 0);
  assert.notEqual(a.scene.exposure, b.scene.exposure, 'the downstream value must follow time');
});

test('static branches stay cached across evaluations', () => {
  const { g } = build(
    [['shape.torus'], ['material.standard'], ['output.render']],
    [
      [0, 'out', 2, 'geometry'],
      [1, 'out', 2, 'material'],
    ]
  );
  const engine = new Engine();
  const first = engine.evaluate(g, {});
  const second = engine.evaluate(g, {});
  assert.equal(first.errors.size, 0, [...first.errors.values()].join('; '));
  assert.equal(first.evaluated, 3);
  assert.equal(second.cached, 3, 'an untouched graph must be free on frame two');
  assert.equal(second.scene, first.scene, 'the cached scene object is reused');
});

// ---------------------------------------------------------------- presets

test('every shipped preset evaluates cleanly', () => {
  assert.ok(PRESETS.length >= 6, `expected a gallery of presets, got ${PRESETS.length}`);
  assert.ok(PRESETS.some((p) => p.id === 'starter'), 'the starter preset must exist');

  for (const preset of PRESETS) {
    assert.ok(preset.id && preset.title && preset.graph, `${preset.id}: incomplete preset`);
    const data = preset.graph();
    assert.notEqual(data, preset.graph(), 'graph() must return a fresh document each time');

    const g = new Graph(data);
    assert.ok(g.nodes.length > 0, `${preset.id}: empty graph`);
    assert.ok(g.outputNode(), `${preset.id}: no output node`);

    const res = evalOk(g, { time: 0 });
    assert.ok(res.scene.object || res.scene.shader, `${preset.id}: no artwork`);
    let drawables = res.scene.shader ? 1 : 0; // a shader canvas draws a fullscreen triangle
    if (res.scene.object) {
      res.scene.object.traverse((o) => { if (o.isMesh || o.isPoints) drawables++; });
    }
    assert.ok(drawables > 0, `${preset.id}: nothing to draw`);
    assert.ok(res.scene.stats.triangles + res.scene.stats.points > 0 || res.scene.shader, `${preset.id}: no geometry stats`);
  }
});

test('preset documents round-trip through JSON', () => {
  for (const preset of PRESETS) {
    const g = new Graph(preset.graph());
    const restored = new Graph(g.toJSON());
    assert.equal(restored.nodes.length, g.nodes.length, `${preset.id}: node count drifted`);
    assert.equal(restored.links.length, g.links.length, `${preset.id}: link count drifted`);
    // The restored copy must evaluate to the same structure.
    const a = evalOk(g, { time: 0 }).scene;
    const b = evalOk(restored, { time: 0 }).scene;
    if (a.shader || b.shader) {
      assert.ok(a.shader && b.shader, `${preset.id}: shader spec lost in round-trip`);
      assert.equal(b.shader.fragment, a.shader.fragment, `${preset.id}: fragment changed after a JSON round-trip`);
      assert.deepEqual(Object.keys(b.shader.uniforms).sort(), Object.keys(a.shader.uniforms).sort());
      continue;
    }
    assert.equal(b.object.name, a.object.name);
    assert.deepEqual(
      { t: b.stats.triangles, p: b.stats.points },
      { t: a.stats.triangles, p: a.stats.points },
      `${preset.id}: stats changed after a JSON round-trip`
    );
  }
});
