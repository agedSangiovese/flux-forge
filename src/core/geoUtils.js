/**
 * Geometry helpers shared by the deformation, particle and output nodes.
 *
 * Rule of thumb enforced here: these functions never mutate their input. The
 * engine caches geometry objects between frames, so anything that writes a new
 * attribute works on a clone.
 */

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { srgbToLinear } from './values.js';

const MAX_REFINED_VERTS = 900_000;

// ------------------------------------------------------------------ basics

export function cloneGeo(g) {
  return g ? g.clone() : g;
}

export function vertexCount(g) {
  const p = g && g.getAttribute('position');
  return p ? p.count : 0;
}

/** Bounding box / sphere info, cached on the geometry's userData. */
export function boundsInfo(g) {
  if (!g.boundingBox) g.computeBoundingBox();
  if (!g.boundingSphere) g.computeBoundingSphere();
  const bb = g.boundingBox;
  return {
    min: [bb.min.x, bb.min.y, bb.min.z],
    max: [bb.max.x, bb.max.y, bb.max.z],
    center: [
      (bb.min.x + bb.max.x) / 2,
      (bb.min.y + bb.max.y) / 2,
      (bb.min.z + bb.max.z) / 2,
    ],
    size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z],
    radius: g.boundingSphere ? g.boundingSphere.radius : 1,
  };
}

/**
 * A field context carrying the mesh's bounds so gradient-style nodes can
 * normalise against the object instead of world space.
 */
export function fieldCtxFor(g, base = {}) {
  const b = boundsInfo(g);
  return { ...base, min: b.min, max: b.max, size: b.size, center: b.center, radius: b.radius };
}

export function ensureNormals(g) {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

// --------------------------------------------------------------- standardise

/** Clone a geometry down to position + normal + uv, indexed, ready to merge. */
export function standardizeGeometry(g) {
  if (!g || !g.getAttribute('position')) return null;
  let out = g.clone();

  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (!out.getAttribute('uv')) {
    const n = out.getAttribute('position').count;
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!out.index) {
    const welded = mergeVertices(out, 1e-4);
    out.dispose();
    out = welded;
  }
  return out;
}

export function mergeGeometryList(list) {
  const parts = (list || []).filter((g) => g && g.getAttribute && g.getAttribute('position'));
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0].clone();

  const standardised = [];
  for (const g of parts) {
    const s = standardizeGeometry(g);
    if (s) standardised.push(s);
  }
  if (!standardised.length) return null;

  let merged = null;
  try {
    merged = mergeGeometries(standardised, false);
  } catch (err) {
    console.warn('[geo] merge failed', err);
  }
  for (const s of standardised) s.dispose();
  if (!merged) return standardised[0] ? standardised[0].clone() : null;
  merged.computeBoundingSphere();
  merged.computeBoundingBox();
  return merged;
}

// ------------------------------------------------------------------ refine

const edgeKey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);

/** One pass of 1→4 midpoint subdivision across every indexed attribute. */
function subdivideOnce(geo) {
  const index = geo.index.array;
  const pos = geo.getAttribute('position');
  const names = Object.keys(geo.attributes);
  const triCount = index.length / 3;
  const firstNew = pos.count;

  const extra = {};
  for (const name of names) extra[name] = [];

  const edgeMap = new Map();
  let nextIndex = firstNew;

  const midpoint = (i0, i1) => {
    const k = edgeKey(i0, i1);
    const hit = edgeMap.get(k);
    if (hit !== undefined) return hit;
    const id = nextIndex++;
    edgeMap.set(k, id);
    for (const name of names) {
      const a = geo.getAttribute(name);
      const s = a.itemSize;
      const src = a.array;
      const dst = extra[name];
      for (let c = 0; c < s; c++) {
        dst.push((src[i0 * s + c] + src[i1 * s + c]) * 0.5);
      }
    }
    return id;
  };

  const newIndex = new Uint32Array(triCount * 12);
  let w = 0;
  for (let t = 0; t < triCount; t++) {
    const a = index[t * 3];
    const b = index[t * 3 + 1];
    const c = index[t * 3 + 2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    newIndex[w++] = a; newIndex[w++] = ab; newIndex[w++] = ca;
    newIndex[w++] = ab; newIndex[w++] = b; newIndex[w++] = bc;
    newIndex[w++] = ca; newIndex[w++] = bc; newIndex[w++] = c;
    newIndex[w++] = ab; newIndex[w++] = bc; newIndex[w++] = ca;
  }

  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const a = geo.getAttribute(name);
    const s = a.itemSize;
    const added = extra[name].length / s;
    const total = firstNew + added;
    const arr = new Float32Array(total * s);
    const src = a.array;
    for (let i = 0; i < firstNew * s; i++) arr[i] = src[i];
    arr.set(extra[name], firstNew * s);
    out.setAttribute(name, new THREE.BufferAttribute(arr, s, a.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(newIndex, 1));
  return out;
}

/**
 * Add vertices so a painted pattern doesn't look faceted.
 * `levels` of 1→4 midpoint splitting; linear, so the silhouette is unchanged
 * but colour is now sampled at 4× as many places.
 */
export function refineGeometry(geo, levels = 1) {
  if (!geo || levels <= 0) return geo ? geo.clone() : geo;
  let g = geo.index ? geo.clone() : standardizeGeometry(geo);
  if (!g) return geo.clone();

  for (let i = 0; i < levels; i++) {
    if (vertexCount(g) * 4 > MAX_REFINED_VERTS) break;
    const next = subdivideOnce(g);
    g.dispose();
    g = next;
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ------------------------------------------------------------ vertex colours

function writeColorAttribute(geo, field, fieldCtx, name, stride = 3) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const src = pos.array;
  const itemSize = pos.itemSize;
  const arr = new Float32Array(n * stride);

  const put = (i, c) => {
    arr[i * stride] = srgbToLinear(c.r);
    arr[i * stride + 1] = srgbToLinear(c.g);
    arr[i * stride + 2] = srgbToLinear(c.b);
  };

  if (field && field.isConst) {
    const c = normaliseColor(field.constValue);
    for (let i = 0; i < n; i++) put(i, c);
  } else {
    for (let i = 0; i < n; i++) {
      let v;
      try {
        v = field(src[i * itemSize], src[i * itemSize + 1], itemSize > 2 ? src[i * itemSize + 2] : 0, fieldCtx);
      } catch {
        v = null;
      }
      put(i, normaliseColor(v));
    }
  }

  geo.setAttribute(name, new THREE.BufferAttribute(arr, stride));
}

function normaliseColor(v) {
  if (!v) return { r: 1, g: 1, b: 1 };
  if (typeof v === 'number') {
    const g = v < 0 ? 0 : v > 1 ? 1 : v;
    return { r: g, g: g, b: g };
  }
  if (!Number.isFinite(v.r)) return { r: 1, g: 1, b: 1 };
  const cl = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  return { r: cl(v.r), g: cl(v.g), b: cl(v.b) };
}

/**
 * Bake a colour field into a `color` attribute (converted to linear so three's
 * colour management treats it correctly). Mutates `geo` — pass a clone.
 */
export function bakeVertexColors(geo, colorField, fieldCtx) {
  writeColorAttribute(geo, colorField, fieldCtx, 'color');
  return geo;
}

/** Bake a glow field into the `aEmissive` attribute consumed by material nodes. */
export function bakeEmissive(geo, colorField, fieldCtx) {
  writeColorAttribute(geo, colorField, fieldCtx, 'aEmissive');
  return geo;
}

// ---------------------------------------------------------------- sampling

/** Average every attribute for the vertices sharing a position (smooth pass). */
export function smoothPositions(geo, strength = 0.35) {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const src = pos.array;
  const groups = new Map();

  for (let i = 0; i < n; i++) {
    const k = `${src[i * 3].toFixed(4)}_${src[i * 3 + 1].toFixed(4)}_${src[i * 3 + 2].toFixed(4)}`;
    let list = groups.get(k);
    if (!list) groups.set(k, (list = []));
    list.push(i);
  }

  const out = new Float32Array(n * 3);
  out.set(src);

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (const i of list) {
      ax += src[i * 3];
      ay += src[i * 3 + 1];
      az += src[i * 3 + 2];
    }
    ax /= list.length;
    ay /= list.length;
    az /= list.length;
    for (const i of list) {
      out[i * 3] = src[i * 3] + (ax - src[i * 3]) * strength;
      out[i * 3 + 1] = src[i * 3 + 1] + (ay - src[i * 3 + 1]) * strength;
      out[i * 3 + 2] = src[i * 3 + 2] + (az - src[i * 3 + 2]) * strength;
    }
  }

  const next = geo.clone();
  next.setAttribute('position', new THREE.BufferAttribute(out, 3));
  next.computeVertexNormals();
  next.computeBoundingSphere();
  next.computeBoundingBox();
  return next;
}

/** Apply a TRS transform without disturbing the cached original. */
export function transformGeometry(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q, new THREE.Vector3(scale[0], scale[1], scale[2]));
  const out = geo.clone();
  out.applyMatrix4(m);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
