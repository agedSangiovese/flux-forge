/**
 * Port type system.
 *
 * A port's declared `type` is a contract between the graph and the node that
 * receives it. The Engine coerces whatever arrives on the wire into exactly the
 * shape the receiving node asked for, so node implementations never have to
 * guess what they were handed.
 *
 *   number   -> plain JS number             (functions are sampled at the origin)
 *   field    -> (x, y, z, ctx) => number    (constants are wrapped as constant fields)
 *   color    -> passed through untouched: a hex string, an {r,g,b} object, or
 *               (x, y, z, ctx) => {r,g,b}. Nodes use sampleColor() which accepts
 *               all three. Scalars arriving on a colour port become greyscale.
 *   geometry -> THREE.BufferGeometry
 *   material -> material descriptor (see nodes/material.js)
 *   points   -> points payload   (see core/points.js contract in Engine docs)
 *   scene    -> scene setting spec, discriminated by `.kind`
 *   shader   -> a GLSL expression value `{ kind: 'expr', dim, expr, ... }`
 *               (see core/glsl.js). Numbers, constant fields and colours fold
 *               into float / vec3 literals; CPU field functions are sampled
 *               once at the origin, like number ports do.
 *   texture  -> a texture value `{ kind: 'texture', texture, ... }` holding a
 *               THREE.Texture (or null until its file loads / headless).
 *   any      -> accepts everything
 *
 * Colour values inside fields are always **sRGB, 0..1**. Conversion to linear
 * happens exactly once, when writing vertex colours for the GPU.
 */

const SCALAR = new Set(['number', 'field']);

export const PORT_TYPES = {
  number: { label: 'Number', color: '#f0b429', hint: 'A single value.' },
  field: { label: 'Field', color: '#38bdf8', hint: 'A value that varies across space.' },
  color: { label: 'Colour', color: '#fb7185', hint: 'Solid or patterned colour.' },
  geometry: { label: 'Geometry', color: '#a78bfa', hint: 'A triangle mesh.' },
  material: { label: 'Material', color: '#34d399', hint: 'How a surface reacts to light.' },
  points: { label: 'Points', color: '#fb923c', hint: 'A cloud of points.' },
  scene: { label: 'Scene', color: '#2dd4bf', hint: 'Sky, fog, camera or lights.' },
  shader: { label: 'Shader', color: '#a3e635', hint: 'A GLSL expression.' },
  texture: { label: 'Texture', color: '#f472b6', hint: 'An image for shaders.' },
  any: { label: 'Any', color: '#94a3b8', hint: 'Accepts anything.' },
};

/** Can a wire run from `sourceType` into `targetType`? */
export function accepts(targetType, sourceType) {
  if (!targetType || !sourceType) return true;
  if (targetType === 'any' || sourceType === 'any') return true;
  if (SCALAR.has(targetType) && SCALAR.has(sourceType)) return true;
  if (targetType === 'color' && SCALAR.has(sourceType)) return true;
  if (SCALAR.has(targetType) && sourceType === 'color') return true;
  if (targetType === 'shader' && (sourceType === 'shader' || sourceType === 'number' || sourceType === 'field' || sourceType === 'color')) return true;
  return targetType === sourceType;
}

export function portColor(type) {
  return (PORT_TYPES[type] || PORT_TYPES.any).color;
}

export function portLabel(type) {
  return (PORT_TYPES[type] || PORT_TYPES.any).label;
}

export function isScalarType(type) {
  return SCALAR.has(type);
}
