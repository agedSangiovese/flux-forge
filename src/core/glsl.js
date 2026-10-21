/**
 * GLSL codegen helpers for the 2D shader workspace.
 *
 * A shader value is a plain object — `{ kind: 'expr', dim, expr, uniforms,
 * decls }` — where `expr` is a GLSL expression string, `dim` its vector width
 * (1..4), `uniforms` a `{ name: value }` map of extra uniforms the expression
 * needs (texture samplers), and `decls` the matching `uniform ...;` lines.
 * Everything here is pure string work, so it runs headless in tests; only
 * the node implementations in src/nodes/media.js touch real textures.
 *
 * Conventions:
 *  - every generated sub-expression is parenthesised, so nesting is safe;
 *  - pointwise ops broadcast scalars over vectors (like GLSL itself) and trim
 *    the wider side when two different vector widths meet, so graphs compile;
 *  - colours are authored as vec3 in sRGB 0..1 — what you write is what the
 *    canvas shows (no tone mapping on the shader quad).
 */

export function gfloat(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0.0';
  if (v === 0) return '0.0';
  const s = String(v);
  return /[.eEn]/.test(s) ? s : `${s}.0`;
}

export function sanitizeIdent(s) {
  const t = String(s == null ? 'x' : s).replace(/[^A-Za-z0-9_]/g, '_');
  if (!t) return 'u_x';
  return /^[0-9]/.test(t) ? `u_${t}` : t;
}

/** Build a shader value. `dim` is clamped to 1..4. */
export function gexpr(dim, expr, extra = {}) {
  const d = Math.round(Number(dim));
  return {
    kind: 'expr',
    dim: Number.isFinite(d) ? Math.min(4, Math.max(1, d)) : 1,
    expr: String(expr),
    uniforms: { ...(extra.uniforms || {}) },
    decls: [...(extra.decls || [])],
  };
}

/** Accept whatever arrived on a shader port and return a shader value. */
export function asExpr(v) {
  if (v && v.kind === 'expr') return v;
  if (typeof v === 'number') return gexpr(1, gfloat(v));
  return gexpr(1, '0.0');
}

/** Merge the uniform needs of several shader values (dedupes declarations). */
export function mergeParts(parts) {
  const uniforms = {};
  const decls = [];
  for (const p of parts) {
    if (!p || p.kind !== 'expr') continue;
    Object.assign(uniforms, p.uniforms);
    for (const d of p.decls) if (!decls.includes(d)) decls.push(d);
  }
  return { uniforms, decls };
}

const SWIZZLE_FOR = { 2: 'rg', 3: 'rgb' };

/**
 * Combine two operands for a pointwise op: scalars broadcast, and when two
 * different vector widths meet the wider side is trimmed so the result
 * compiles. Returns [aExpr, bExpr, resultDim].
 */
export function matchDims(a, da, b, db) {
  if (da === db || da === 1 || db === 1) return [a, b, Math.max(da, db)];
  const to = Math.min(da, db);
  const sw = SWIZZLE_FOR[to] || 'rg';
  return [da > db ? `(${a}).${sw}` : a, db > da ? `(${b}).${sw}` : b, to];
}

function pointwise2(id, label, gen) {
  return {
    id,
    label,
    arity: 2,
    run: (A, B) => {
      const [a, b, dim] = matchDims(A.expr, A.dim, B.expr, B.dim);
      return gexpr(dim, gen(a, b), mergeParts([A, B]));
    },
  };
}

function trimTo(expr, dim, to) {
  if (dim <= to || to < 2) return expr;
  return `(${expr}).${to === 2 ? 'rg' : 'rgb'}`;
}

function pointwise3(id, label, gen) {
  return {
    id,
    label,
    arity: 3,
    run: (A, B, C) => {
      // All three sides meet at the narrowest vector width (scalars
      // broadcast), so mix/clamp/smoothstep always compile.
      const vecDims = [A.dim, B.dim, C.dim].filter((d) => d > 1);
      const to = vecDims.length ? Math.min(...vecDims) : 1;
      return gexpr(
        to,
        gen(trimTo(A.expr, A.dim, to), trimTo(B.expr, B.dim, to), trimTo(C.expr, C.dim, to)),
        mergeParts([A, B, C])
      );
    },
  };
}

function unary(id, label, gen) {
  return {
    id,
    label,
    arity: 1,
    run: (A) => gexpr(A.dim, gen(A.expr), mergeParts([A])),
  };
}

/** Every operation the Shader Op node offers. */
export const SHADER_OPS = [
  pointwise2('add', 'Add (a + b)', (a, b) => `(${a} + ${b})`),
  pointwise2('sub', 'Subtract (a − b)', (a, b) => `(${a} - ${b})`),
  pointwise2('mul', 'Multiply (a × b)', (a, b) => `(${a} * ${b})`),
  pointwise2('div', 'Divide (a ÷ b)', (a, b) => `(${a} / ${b})`),
  pointwise2('pow', 'Power (aᵇ, a ≥ 0)', (a, b) => `pow(max(${a}, 0.0), ${b})`),
  pointwise2('min', 'Minimum', (a, b) => `min(${a}, ${b})`),
  pointwise2('max', 'Maximum', (a, b) => `max(${a}, ${b})`),
  pointwise2('mod', 'Modulo', (a, b) => `mod(${a}, ${b})`),
  pointwise3('mix', 'Mix (a → b by t)', (a, b, t) => `mix(${a}, ${b}, ${t})`),
  pointwise3('clamp', 'Clamp (a to [b, c])', (a, b, c) => `clamp(${a}, ${b}, ${c})`),
  pointwise2('step', 'Step (edge a, x b)', (a, b) => `step(${a}, ${b})`),
  pointwise3('smoothstep', 'Smoothstep', (a, b, c) => `smoothstep(${a}, ${b}, ${c})`),
  {
    id: 'length',
    label: 'Length (|a|)',
    arity: 1,
    run: (A) => gexpr(1, `length(${A.expr})`, mergeParts([A])),
  },
  {
    id: 'dot',
    label: 'Dot product',
    arity: 2,
    run: (A, B) => {
      const [a, b] = matchDims(A.expr, A.dim, B.expr, B.dim);
      return gexpr(1, `dot(${a}, ${b})`, mergeParts([A, B]));
    },
  },
  {
    id: 'dist',
    label: 'Distance (|a − b|)',
    arity: 2,
    run: (A, B) => {
      const [a, b] = matchDims(A.expr, A.dim, B.expr, B.dim);
      return gexpr(1, `distance(${a}, ${b})`, mergeParts([A, B]));
    },
  },
  unary('normalize', 'Normalize', (a) => `normalize(${a})`),
  unary('abs', 'Absolute', (a) => `abs(${a})`),
  unary('fract', 'Fraction', (a) => `fract(${a})`),
  unary('floor', 'Floor', (a) => `floor(${a})`),
  unary('ceil', 'Ceiling', (a) => `ceil(${a})`),
  unary('sin', 'Sine', (a) => `sin(${a})`),
  unary('cos', 'Cosine', (a) => `cos(${a})`),
  unary('tan', 'Tangent', (a) => `tan(${a})`),
  unary('negate', 'Negate (−a)', (a) => `(-${a})`),
  unary('oneMinus', 'One minus (1 − a)', (a) => `(1.0 - ${a})`),
];

export function shaderOp(id) {
  return SHADER_OPS.find((o) => o.id === id) || SHADER_OPS[0];
}

/** Wrap any expression as the vec4 gl_FragColor needs. */
export function asVec4(e) {
  const v = e && e.kind === 'expr' ? e : gexpr(3, 'vec3(0.0)');
  if (v.dim === 4) return v.expr;
  if (v.dim === 3) return `vec4(${v.expr}, 1.0)`;
  if (v.dim === 2) return `vec4(${v.expr}, 0.0, 1.0)`;
  return `vec4(${v.expr}, ${v.expr}, ${v.expr}, 1.0)`;
}

/** Sampler uniform name for the texture produced by `nodeId` (stable per doc). */
export function samplerName(nodeId) {
  return `u_tex_${sanitizeIdent(nodeId)}`;
}

export function samplerDecl(name) {
  return `uniform sampler2D ${name};`;
}

/** Coordinate expressions for UV space (shared by the UV node and noise). */
export function uvExpr(mode) {
  if (mode === 'pixel') return 'gl_FragCoord.xy';
  if (mode === 'uv') return '(gl_FragCoord.xy / u_resolution)';
  return '((2.0 * (gl_FragCoord.xy / u_resolution) - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0))';
}

// ------------------------------------------------------------- GPU noise
//
// Self-contained value-noise + fbm with fixed function names: identical
// declaration strings merge to a single copy no matter how many noise nodes
// a graph holds. Per-node variation (scale, octaves, seed, shaping) lives in
// the call expression. Octaves loop to a constant bound with a uniform break
// — the ShaderToy-standard trick, fine on ANGLE. Output is 0..1, mask-ready.

export const NOISE_DECLS = [
  'float ff_hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
  'float ff_vnoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(ff_hash21(i), ff_hash21(i + vec2(1.0, 0.0)), u.x), mix(ff_hash21(i + vec2(0.0, 1.0)), ff_hash21(i + vec2(1.0, 1.0)), u.x), u.y); }',
  'float ff_fbm(vec2 p, int oct) { float v = 0.0; float a = 0.5; for (int i = 0; i < 8; i++) { if (i >= oct) break; v += a * ff_vnoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; } return v; }',
];

/** fbm call shaped into the requested character (always 0..1). */
export function noiseCallExpr({ pos, scale, oct, seed, mode }) {
  const s = Number.isFinite(Number(scale)) ? Number(scale) : 3;
  const o = Math.min(8, Math.max(1, Math.round(Number(oct)) || 4));
  const sd = Math.max(0, Math.round(Number(seed)) || 0);
  const base = `ff_fbm((${pos}) * ${gfloat(s)} + vec2(${gfloat(sd * 0.61803)}, ${gfloat(sd * 1.61803)}), ${o})`;
  if (mode === 'billow') return `(abs((${base}) * 2.0 - 1.0))`;
  if (mode === 'ridged') return `(pow(1.0 - abs((${base}) * 2.0 - 1.0), 2.0))`;
  return `(${base})`;
}

/**
 * Assemble the final fragment shader. `color` is the vetted colour
 * expression; its merged decls/uniforms ride along inside it.
 */
export function assembleFragment(color) {
  const decls = color && color.kind === 'expr' ? color.decls : [];
  return [
    'uniform float u_time;',
    'uniform vec2 u_resolution;',
    'uniform vec4 u_mouse;',
    'uniform int u_frame;',
    ...decls,
    'void main() {',
    `  vec4 _c = ${asVec4(color)};`,
    '  gl_FragColor = _c;',
    '}',
  ].join('\n');
}

/** A black fallback fragment, used when the colour expression is missing. */
export const BLACK_FRAGMENT = [
  'uniform float u_time;',
  'uniform vec2 u_resolution;',
  'uniform vec4 u_mouse;',
  'uniform int u_frame;',
  'void main() {',
  '  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);',
  '}',
].join('\n');
