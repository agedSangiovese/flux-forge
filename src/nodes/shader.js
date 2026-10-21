/**
 * 2D shader workspace — GLSL expressions and the fullscreen sink.
 *
 * Every node here evaluates to a shader value (see src/core/glsl.js): a
 * `{ kind: 'expr', dim, expr, uniforms, decls }` object the engine carries
 * untouched on `shader` ports. Numbers, colours and constant fields fold into
 * literals on the way in (see values.js), so constants can be typed straight
 * into the inline boxes. `output.shader` assembles the final fragment shader;
 * the preview renders it on a fullscreen triangle (see src/render/index.js).
 *
 * Time, resolution, mouse and frame are render-side uniforms — u_time,
 * u_resolution, u_mouse, u_frame — always available, never wired.
 */
import { define } from './define.js';
import {
  gexpr,
  asExpr,
  mergeParts,
  shaderOp,
  assembleFragment,
  samplerName,
  samplerDecl,
  uvExpr,
  NOISE_DECLS,
  noiseCallExpr,
  BLACK_FRAGMENT,
} from '../core/glsl.js';

define('shader.uv', (ctx, inputs) => ({ out: gexpr(2, uvExpr(inputs.mode || 'center')) }));

define('shader.noise', (ctx, inputs) => {
  const coords = inputs.coords || 'center';
  let pos = null;
  let posParts = null;
  if (coords === 'socket') {
    const wired = ctx.graph.incoming(ctx.node.id, 'pos').length > 0;
    if (!wired) {
      ctx.error('Noise in socket mode needs coordinates plugged into Position — try the UV node.');
      return { out: gexpr(1, '0.0') };
    }
    pos = asExpr(inputs.pos);
    posParts = mergeParts([pos]);
  } else {
    pos = gexpr(2, uvExpr(coords));
    posParts = mergeParts([pos]);
  }
  return {
    out: gexpr(
      1,
      noiseCallExpr({ pos: pos.expr, scale: inputs.scale, oct: inputs.octaves, seed: inputs.seed, mode: inputs.mode }),
      { uniforms: { ...posParts.uniforms }, decls: [...posParts.decls, ...NOISE_DECLS] }
    ),
  };
});

define('shader.vec', (ctx, inputs) => {
  const width = Math.min(4, Math.max(2, Math.round(Number(inputs.width)) || 3));
  const comps = [asExpr(inputs.x), asExpr(inputs.y), asExpr(inputs.z), asExpr(inputs.w)];
  const parts = mergeParts(comps);
  return {
    out: gexpr(width, `vec${width}(${comps.slice(0, width).map((c) => c.expr).join(', ')})`, parts),
  };
});

define('shader.op', (ctx, inputs) => {
  const op = shaderOp(inputs.op);
  const args = [asExpr(inputs.a), asExpr(inputs.b), asExpr(inputs.c)].slice(0, op.arity);
  while (args.length < op.arity) args.push(gexpr(1, '0.0'));
  return { out: op.run(...args) };
});

define('shader.swizzle', (ctx, inputs) => {
  const value = asExpr(inputs.value);
  const mask = String(inputs.mask ?? 'rgb');
  // GLSL swizzles come in three families that must never be mixed.
  const ok =
    /^[rgba]{1,4}$/.test(mask) || /^[xyzw]{1,4}$/.test(mask) || /^[stpq]{1,4}$/.test(mask);
  if (!ok) {
    ctx.error(`Swizzle mask must be 1–4 channels from one family (rgba, xyzw or stpq) — got “${mask}”.`);
    return { out: value };
  }
  return { out: gexpr(mask.length, `(${(value.expr)}).${mask}`, mergeParts([value])) };
});

define('shader.sample', (ctx, inputs) => {
  const wired = ctx.graph.incoming(ctx.node.id, 'texture').length > 0;
  if (!wired) {
    ctx.error('Sample Texture needs an image plugged into Texture — try the Image node.');
    return { out: gexpr(4, 'vec4(1.0, 0.0, 1.0, 1.0)') };
  }
  const tex = inputs.texture;
  if (!tex || tex.kind !== 'texture') {
    ctx.error('That wire carries no texture — plug in Image, Text Plate, Video or Data Table.');
    return { out: gexpr(4, 'vec4(1.0, 0.0, 1.0, 1.0)') };
  }
  const link = ctx.graph.incoming(ctx.node.id, 'texture')[0];
  const name = samplerName(link.from);
  const uv = asExpr(inputs.uv);
  return {
    out: gexpr(4, `texture2D(${name}, ${uv.expr})`, {
      uniforms: { ...uv.uniforms, [name]: tex.texture || null },
      decls: [...uv.decls, samplerDecl(name)],
    }),
  };
});

define('shader.blur', (ctx, inputs) => {
  const wired = ctx.graph.incoming(ctx.node.id, 'texture').length > 0;
  if (!wired) {
    ctx.error('Blur needs an image plugged into Texture — try the Image node.');
    return { out: gexpr(4, 'vec4(1.0, 0.0, 1.0, 1.0)') };
  }
  const tex = inputs.texture;
  if (!tex || tex.kind !== 'texture') {
    ctx.error('That wire carries no texture — plug in Image, Text Plate, Video or Data Table.');
    return { out: gexpr(4, 'vec4(1.0, 0.0, 1.0, 1.0)') };
  }
  const uvWired = ctx.graph.incoming(ctx.node.id, 'uv').length > 0;
  if (!uvWired) {
    ctx.error('Blur needs coordinates plugged into UV — try the UV node.');
    return { out: gexpr(4, 'vec4(1.0, 0.0, 1.0, 1.0)') };
  }
  const link = ctx.graph.incoming(ctx.node.id, 'texture')[0];
  const name = samplerName(link.from);
  const uv = asExpr(inputs.uv);
  const r = asExpr(inputs.radius);
  // 3×3 box blur; radius is in pixels, converted with the real buffer size.
  const taps = [];
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      taps.push(
        `texture2D(${name}, (${uv.expr}) + vec2(${(dx === 0 ? '0.0' : `${dx}.0`)} * (${r.expr}) / u_resolution.x, ${(dy === 0 ? '0.0' : `${dy}.0`)} * (${r.expr}) / u_resolution.y))`
      );
    }
  }
  return {
    out: gexpr(4, `((${taps.join(' + ')}) / 9.0)`, {
      uniforms: { ...uv.uniforms, ...r.uniforms, [name]: tex.texture || null },
      decls: [...uv.decls, ...r.decls, samplerDecl(name)],
    }),
  };
});

define('shader.expr', (ctx, inputs) => {  const code = String(inputs.code ?? '0.0');
  const a = asExpr(inputs.a);
  const b = asExpr(inputs.b);
  const c = asExpr(inputs.c);
  const dim = Math.min(4, Math.max(1, Math.round(Number(inputs.dim)) || 3));
  // Bare a, b and c stand for the three inputs (word boundaries, so `tan`
  // and friends survive). They are reserved words inside snippets.
  const expr = code
    .replace(/\ba\b/g, `(${a.expr})`)
    .replace(/\bb\b/g, `(${b.expr})`)
    .replace(/\bc\b/g, `(${c.expr})`);
  return { out: gexpr(dim, `(${expr})`, mergeParts([a, b, c])) };
});

define('output.shader', (ctx, inputs) => {
  const wired = ctx.graph.incoming(ctx.node.id, 'color').length > 0;
  const color = inputs.color;
  if (!wired || !color || color.kind !== 'expr') {
    ctx.error('Shader Canvas has nothing to show yet — plug an expression into Colour.');
    return { scene: { shader: { fragment: BLACK_FRAGMENT, uniforms: {} }, stats: { triangles: 0, points: 0, vertices: 0 } } };
  }
  return {
    scene: {
      shader: { fragment: assembleFragment(color), uniforms: { ...color.uniforms }, decls: [...color.decls] },
      stats: { triangles: 0, points: 0, vertices: 0 },
    },
  };
});
