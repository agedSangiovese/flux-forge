/**
 * 2D shader workspace tests — run with `npm test`.
 *
 * Covers the GLSL codegen (src/core/glsl.js), the shader/texture coercion in
 * values.js, the media input nodes (headless: no decoding, placeholders only)
 * and engine integration through output.shader.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  gfloat,
  gexpr,
  asExpr,
  matchDims,
  shaderOp,
  SHADER_OPS,
  asVec4,
  assembleFragment,
  sanitizeIdent,
  samplerName,
} from '../src/core/glsl.js';
import { coerce, defaultForType, constField } from '../src/core/values.js';
import { accepts } from '../src/core/portTypes.js';
import { parseDataTable } from '../src/nodes/media.js';
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

function evalOk(graph, options = {}) {
  const engine = new Engine();
  const res = engine.evaluate(graph, options);
  assert.equal(res.errors.size, 0, `unexpected errors:\n  ${[...res.errors.values()].join('\n  ')}`);
  assert.ok(res.scene, 'the graph must produce a scene');
  return res;
}

// ------------------------------------------------------------- codegen

test('gfloat emits valid GLSL float literals', () => {
  assert.equal(gfloat(1), '1.0');
  assert.equal(gfloat(0), '0.0');
  assert.equal(gfloat(-2), '-2.0');
  assert.equal(gfloat(0.5), '0.5');
  assert.equal(gfloat(2.25), '2.25');
  assert.equal(gfloat(NaN), '0.0');
  assert.equal(gfloat(Infinity), '0.0');
});

test('gexpr clamps dims and copies uniform needs', () => {
  assert.equal(gexpr(0, 'x').dim, 1);
  assert.equal(gexpr(9, 'x').dim, 4);
  assert.equal(gexpr(NaN, 'x').dim, 1);
  const u = { a: 1 };
  const e = gexpr(3, 'y', { uniforms: u, decls: ['d'] });
  u.a = 2;
  assert.equal(e.uniforms.a, 1, 'uniforms must be copied, not aliased');
  assert.deepEqual(e.decls, ['d']);
});

test('matchDims broadcasts scalars and trims wider vectors', () => {
  assert.deepEqual(matchDims('a', 3, 'b', 3), ['a', 'b', 3]);
  assert.deepEqual(matchDims('a', 3, 'b', 1), ['a', 'b', 3]);
  assert.deepEqual(matchDims('a', 1, 'b', 2), ['a', 'b', 2]);
  assert.deepEqual(matchDims('a', 4, 'b', 3), ['(a).rgb', 'b', 3]);
  assert.deepEqual(matchDims('a', 2, 'b', 4), ['a', '(b).rg', 2]);
});

test('every shader op is well-formed and vector-safe', () => {
  assert.ok(SHADER_OPS.length >= 20, `expected a rich op table, got ${SHADER_OPS.length}`);
  const v3 = gexpr(3, 'v3');
  const v4 = gexpr(4, 'v4');
  const f = gexpr(1, 'f');
  for (const op of SHADER_OPS) {
    assert.ok(op.id && op.label, 'op needs id and label');
    assert.ok(op.arity >= 1 && op.arity <= 3, `${op.id}: bad arity`);
    const out = op.run(v3, v4, f);
    assert.equal(out.kind, 'expr', `${op.id}: must return an expr`);
    assert.ok(out.dim >= 1 && out.dim <= 4, `${op.id}: bad dim`);
    assert.ok(out.dim <= 3 || op.arity === 1, `${op.id}: a 4-wide result must come from trimming, got ${out.dim}`);
  }
  assert.equal(shaderOp('nope').id, 'add', 'unknown ops fall back to add');
});

test('spot-checks: add, mix, length, dist', () => {
  const v3 = gexpr(3, 'v3');
  const f = gexpr(1, 'f');
  assert.equal(shaderOp('add').run(v3, f).expr, '(v3 + f)');
  assert.equal(shaderOp('mix').run(v3, f, f).expr, 'mix(v3, f, f)');
  const len = shaderOp('length').run(v3);
  assert.equal(len.dim, 1);
  assert.equal(len.expr, 'length(v3)');
  const dist = shaderOp('dist').run(gexpr(4, 'a'), gexpr(3, 'b'));
  assert.equal(dist.dim, 1);
  assert.equal(dist.expr, 'distance((a).rgb, b)');
});

test('asVec4 wraps every width into valid gl_FragColor input', () => {
  assert.equal(asVec4(gexpr(1, 'e')), 'vec4(e, e, e, 1.0)');
  assert.equal(asVec4(gexpr(2, 'e')), 'vec4(e, 0.0, 1.0)');
  assert.equal(asVec4(gexpr(3, 'e')), 'vec4(e, 1.0)');
  assert.equal(asVec4(gexpr(4, 'e')), 'e');
  assert.equal(asVec4(null), 'vec4(vec3(0.0), 1.0)');
});

test('assembleFragment declares the standard uniforms', () => {
  const frag = assembleFragment(gexpr(3, 'v', { decls: ['uniform sampler2D u_tex_a;'] }));
  for (const u of ['uniform float u_time;', 'uniform vec2 u_resolution;', 'uniform vec4 u_mouse;', 'uniform int u_frame;']) {
    assert.ok(frag.includes(u), `fragment must declare ${u}`);
  }
  assert.ok(frag.includes('uniform sampler2D u_tex_a;'));
  assert.ok(frag.includes('vec4 _c = vec4(v, 1.0);'));
  assert.ok(frag.includes('gl_FragColor = _c;'));
});

test('identifiers are sanitised for GLSL', () => {
  assert.equal(sanitizeIdent('n_abc123'), 'n_abc123');
  assert.equal(sanitizeIdent('a b-c'), 'a_b_c');
  assert.equal(sanitizeIdent('9x'), 'u_9x');
  assert.ok(samplerName('n_1a2b').startsWith('u_tex_'));
});

// ------------------------------------------------------------- coercion

test('values fold into GLSL on shader ports', () => {
  const lit = coerce(2, 'shader', 'number', 0);
  assert.equal(lit.kind, 'expr');
  assert.equal(lit.dim, 1);
  assert.equal(lit.expr, '2.0');

  const col = coerce('#ff0000', 'shader', 'color', '#fff');
  assert.equal(col.dim, 3);
  assert.ok(col.expr.startsWith('vec3(') && col.expr.includes('1.0'), `red must fold to vec3, got ${col.expr}`);

  const cf = coerce(constField(0.25), 'shader', 'field', 0);
  assert.equal(cf.expr, '0.25', 'constant fields sample once at the origin');

  const e = gexpr(2, 'uv');
  assert.equal(coerce(e, 'shader', 'shader', 0), e, 'exprs pass through untouched');
  assert.equal(defaultForType('shader').expr, '0.0');
});

test('texture ports only carry textures', () => {
  const t = { kind: 'texture', texture: null };
  assert.equal(coerce(t, 'texture', 'texture', null), t);
  assert.equal(coerce(42, 'texture', 'number', null), null);
  assert.equal(coerce(null, 'texture', 'texture', null), null);
  assert.equal(defaultForType('texture'), null);
});

test('shader wire compatibility', () => {
  assert.ok(accepts('shader', 'shader'));
  assert.ok(accepts('shader', 'number'), 'constants fold into literals');
  assert.ok(accepts('shader', 'field'), 'fields sample at the origin');
  assert.ok(accepts('shader', 'color'), 'colours fold into vec3');
  assert.ok(!accepts('shader', 'texture'), 'textures need Sample Texture');
  assert.ok(!accepts('shader', 'geometry'));
  assert.ok(!accepts('number', 'shader'), 'GLSL cannot run on the CPU');
  assert.ok(accepts('texture', 'texture'));
  assert.ok(!accepts('texture', 'shader'));
});

// ---------------------------------------------------------------- media

test('parseDataTable reads JSON and CSV number grids', () => {
  const flat = parseDataTable('[1, 2, 3, 4]');
  assert.deepEqual([flat.width, flat.height], [4, 1]);
  assert.deepEqual(Array.from(flat.data), [1, 2, 3, 4]);

  const nested = parseDataTable('[[1, 2], [3, 4]]');
  assert.deepEqual([nested.width, nested.height], [2, 2]);

  const csv = parseDataTable('1,2\n3,4\n');
  assert.deepEqual([csv.width, csv.height], [2, 2]);
  assert.deepEqual(Array.from(csv.data), [1, 2, 3, 4]);

  assert.ok(parseDataTable('').error, 'empty is an error');
  assert.ok(parseDataTable('hello').error, 'prose is an error');
  assert.ok(parseDataTable('[]').error, 'no numbers is an error');
});

test('the 2D nodes declare themselves', () => {
  assert.ok(installNodes(), 'every manifest node must be implemented');
  for (const t of ['input.image', 'input.text', 'input.video', 'input.data', 'shader.uv', 'shader.vec',
    'shader.op', 'shader.swizzle', 'shader.sample', 'shader.expr', 'output.shader']) {
    assert.ok(MANIFEST.some((d) => d.type === t), `${t} must be in the manifest`);
  }
  const out = MANIFEST.find((d) => d.type === 'output.shader');
  assert.equal(out.isOutput, true);
  assert.equal(out.outputs.length, 0);
});

test('file inputs evaluate headless with placeholders', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const { g } = build(
    [
      ['input.image', { src: png }, 'img'],
      ['input.text', { text: 'HI', size: 64, color: '#ffffff' }, 'txt'],
      ['input.video', { src: 'data:video/mp4;base64,AAAA' }, 'vid'],
      ['input.data', { src: '[0, 0.5, 1]' }, 'dat'],
      ['shader.uv', {}, 'uv'],
      ['shader.sample', {}, 's1'],
      ['shader.sample', {}, 's2'],
      ['shader.op', { op: 'add' }, 'mx'],
      ['output.shader', {}, 'out'],
    ],
    [
      [0, 'out', 5, 'texture'],
      [4, 'out', 5, 'uv'],
      [3, 'out', 6, 'texture'],
      [4, 'out', 6, 'uv'],
      [5, 'out', 7, 'a'],
      [6, 'out', 7, 'b'],
      [7, 'out', 8, 'color'],
    ]
  );
  const res = evalOk(g, { time: 0 });
  assert.ok(res.scene.shader, 'shader scenes carry the fragment spec');
  const frag = res.scene.shader.fragment;
  assert.ok(frag.includes('gl_FragColor'), 'a fragment must assign the colour');
  assert.ok(frag.includes('texture2D(u_tex_img'), 'samplers derive from the source node id');
  assert.ok(frag.includes('texture2D(u_tex_dat'), 'data textures sample like any other');
  const names = Object.keys(res.scene.shader.uniforms);
  assert.ok(names.some((n) => n.startsWith('u_tex_')), 'sampler uniforms must be collected');
});

test('empty file sockets are hard errors', () => {
  const errors = (g) => new Engine().evaluate(g, { time: 0 }).errors;
  const img = build([['input.image', {}, 'i'], ['output.shader', {}, 'o']], [[0, 'out', 1, 'color']]);
  assert.ok(errors(img.g).size > 0, 'imageless Image must error');
  const badSample = build(
    [['shader.uv', {}, 'u'], ['shader.sample', {}, 's'], ['output.shader', {}, 'o']],
    [[0, 'out', 1, 'uv'], [1, 'out', 2, 'color']]
  );
  const res = new Engine().evaluate(badSample.g, { time: 0 });
  assert.ok(res.errors.size > 0, 'textureless Sample must error');
  assert.ok(res.scene.shader.fragment.includes('1.0, 0.0, 1.0'), 'failures fall back to magenta');
  const noColor = build([['output.shader', {}, 'o']], []);
  assert.ok(errors(noColor.g).size > 0, 'colourless canvas must error');
  const badMask = build(
    [['shader.uv', {}, 'u'], ['shader.swizzle', { mask: 'rx' }, 's'], ['output.shader', {}, 'o']],
    [[0, 'out', 1, 'value'], [1, 'out', 2, 'color']]
  );
  assert.ok(errors(badMask.g).size > 0, 'a mixed-family swizzle mask must error');
});

test('snippets substitute bare a/b/c with word boundaries', () => {
  const { g } = build(
    [
      ['shader.uv', {}, 'uv'],
      ['input.time', {}, 't'],
      ['shader.expr', { code: 'sin(a*6.0+b)*tan(c+1.0)', dim: '1' }, 'e'],
      ['output.shader', {}, 'o'],
    ],
    [
      [0, 'out', 2, 'a'],
      [1, 'out', 2, 'b'],
      [1, 'out', 2, 'c'],
      [2, 'out', 3, 'color'],
    ]
  );
  const frag = evalOk(g, { time: 0 }).scene.shader.fragment;
  assert.ok(!/\ba\b/.test(frag.replace(/uniform float u_time;|u_mouse|u_frame|u_resolution/g, '')), 'no bare input names may survive');
  assert.ok(frag.includes('tan('), 'function names containing a/b/c must survive');
  assert.ok(frag.includes('gl_FragCoord'), 'uv must be inlined where a and c stood');
});

test('shader noise emits shared helpers and shaped masks', () => {
  const { g } = build(
    [
      ['shader.uv', {}, 'uv'],
      ['shader.noise', { coords: 'socket', scale: 2.5, octaves: 3, seed: 6, mode: 'billow' }, 'n1'],
      ['shader.noise', { coords: 'center', mode: 'ridged' }, 'n2'],
      ['shader.op', { op: 'add' }, 'm'],
      ['output.shader', {}, 'o'],
    ],
    [
      [0, 'out', 1, 'pos'],
      [1, 'out', 3, 'a'],
      [2, 'out', 3, 'b'],
      [3, 'out', 4, 'color'],
    ]
  );
  const frag = evalOk(g, { time: 0 }).scene.shader.fragment;
  assert.ok(frag.includes('ff_fbm('), 'fbm must be called');
  assert.ok(frag.includes('abs('), 'billow shapes with abs');
  assert.ok(frag.includes('pow(1.0 - abs('), 'ridged sharpens the valleys');
  assert.equal(frag.split('float ff_fbm(').length - 1, 1, 'helpers merge to a single copy');
  assert.ok(frag.includes(', 3)'), 'octaves arrive as an int literal');
});

test('noise in socket mode needs coordinates', () => {
  const { g } = build([['shader.noise', { coords: 'socket' }, 'n'], ['output.shader', {}, 'o']], [[0, 'out', 1, 'color']]);
  assert.ok(new Engine().evaluate(g, { time: 0 }).errors.size > 0);
});

test('blur taps the texture nine times', () => {
  const { g } = build(
    [
      ['input.text', { text: 'HI' }, 't'],
      ['shader.uv', {}, 'uv'],
      ['shader.blur', { radius: 2.5 }, 'b'],
      ['output.shader', {}, 'o'],
    ],
    [
      [0, 'out', 2, 'texture'],
      [1, 'out', 2, 'uv'],
      [2, 'out', 3, 'color'],
    ]
  );
  const frag = evalOk(g, { time: 0 }).scene.shader.fragment;
  assert.equal(frag.split('texture2D(').length - 1, 9, 'a 3×3 kernel samples nine times');
  assert.ok(frag.includes('/ 9.0'), 'taps are averaged');
  assert.ok(frag.includes('2.5'), 'radius folds in as a literal');
  assert.ok(frag.includes('/ u_resolution.x'), 'offsets convert pixels with the real buffer size');
});

test('blur without a texture errors', () => {
  const { g } = build(
    [['shader.uv', {}, 'u'], ['shader.blur', {}, 'b'], ['output.shader', {}, 'o']],
    [[0, 'out', 1, 'uv'], [1, 'out', 2, 'color']]
  );
  assert.ok(new Engine().evaluate(g, { time: 0 }).errors.size > 0);
});

test('uv modes, vec assembly and snippets compose', () => {
  const { g } = build(
    [
      ['shader.uv', { mode: 'pixel' }, 'uv'],
      ['shader.swizzle', { mask: 'xy' }, 'sw'],
      ['shader.vec', { width: '3', x: 0.1 }, 'v'],
      ['shader.op', { op: 'length' }, 'm'],
      ['input.time', { speed: 2 }, 't'],
      ['output.shader', {}, 'o'],
    ],
    [
      [0, 'out', 1, 'value'],
      [1, 'out', 3, 'a'],
      [4, 'out', 2, 'z'],
      [3, 'out', 2, 'y'],
      [2, 'out', 5, 'color'],
    ]
  );
  const engine = new Engine();
  const res = engine.evaluate(g, { time: 1.5 });
  assert.equal(res.errors.size, 0, [...res.errors.values()].join('; '));
  assert.ok(res.dynamicCount > 0, 'time upstream must mark the branch dynamic');
  const frag = res.scene.shader.fragment;
  assert.ok(frag.includes('gl_FragCoord.xy'), 'pixel mode reads raw coordinates');
  assert.ok(frag.includes('length((gl_FragCoord.xy).xy)'), 'swizzle feeds length');
  assert.ok(frag.includes('vec3(0.1'), 'vec assembly keeps constants');
  assert.ok(frag.includes(', 3.0)'), 'time folds in as a literal (1.5s × speed 2)');
  const again = engine.evaluate(g, { time: 2.5 }).scene.shader.fragment;
  assert.notEqual(again, frag, 'the baked time literal must advance with the clock');
});
