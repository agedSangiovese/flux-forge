/**
 * Points payload contract.
 *
 * Particle nodes produce a plain typed-array bundle rather than a THREE object,
 * so it serialises, diffs and merges cheaply:
 *
 *   {
 *     positions: Float32Array,   // xyz per point
 *     colors:    Float32Array|null, // rgb per point, sRGB 0..1
 *     sizes:     Float32Array|null, // per-point size multiplier
 *     normals:   Float32Array|null,
 *     count:     number,
 *   }
 *
 * The output node turns it into a BufferGeometry; the points material decides
 * whether to use the bundled colours or its own.
 */

import * as THREE from 'three';

export function emptyPoints() {
  return { positions: new Float32Array(0), colors: null, sizes: null, normals: null, count: 0 };
}

export function makePoints(positions, extra = {}) {
  return {
    positions,
    colors: null,
    sizes: null,
    normals: null,
    count: (positions.length / 3) | 0,
    ...extra,
  };
}

/** Combine several payloads (used when several scatter nodes feed one output). */
export function mergePoints(list) {
  const parts = list.filter((p) => p && p.positions && p.positions.length);
  if (!parts.length) return emptyPoints();
  if (parts.length === 1) return parts[0];

  let total = 0;
  for (const p of parts) total += p.count;
  const anyColors = parts.some((p) => p.colors);
  const anySizes = parts.some((p) => p.sizes);

  const positions = new Float32Array(total * 3);
  const colors = anyColors ? new Float32Array(total * 3) : null;
  const sizes = anySizes ? new Float32Array(total) : null;
  let offset = 0;

  for (const p of parts) {
    positions.set(p.positions.subarray(0, p.count * 3), offset * 3);
    if (colors) {
      if (p.colors) colors.set(p.colors.subarray(0, p.count * 3), offset * 3);
      else colors.fill(1, offset * 3, (offset + p.count) * 3);
    }
    if (sizes) {
      if (p.sizes) sizes.set(p.sizes.subarray(0, p.count), offset);
      else sizes.fill(1, offset, offset + p.count);
    }
    offset += p.count;
  }

  return { positions, colors, sizes, normals: null, count: total };
}

/** Build the BufferGeometry the renderer will show. */
export function pointsToGeometry(payload) {
  const geo = new THREE.BufferGeometry();
  const count = payload.count || (payload.positions.length / 3) | 0;
  geo.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3));
  if (payload.colors) geo.setAttribute('color', new THREE.BufferAttribute(payload.colors, 3));
  if (payload.normals) geo.setAttribute('normal', new THREE.BufferAttribute(payload.normals, 3));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Evaluate a field over every point, producing a fresh attribute array.
 * Returns null when the field is a provable constant (no per-point variety).
 */
export function sampleFieldOverPoints(field, positions, count, fieldCtx, fallback = 1) {
  if (!field) return null;
  const out = new Float32Array(count);
  if (field.isConst) {
    out.fill(Number.isFinite(field.constValue) ? field.constValue : fallback);
    return out;
  }
  for (let i = 0; i < count; i++) {
    const r = field(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], fieldCtx);
    out[i] = Number.isFinite(r) ? r : fallback;
  }
  return out;
}
