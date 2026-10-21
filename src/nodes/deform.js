/**
 * Deform nodes — bend, twist, merge and refine meshes.
 *
 * Golden rule from core/geoUtils.js: the engine caches geometry objects
 * between frames, so every node here starts from a `.clone()` (directly or
 * via a helper) and never writes into the object it was handed.
 */
import { define } from './define.js';
import {
  boundsInfo,
  ensureNormals,
  fieldCtxFor,
  mergeGeometryList,
  refineGeometry,
  smoothPositions,
  transformGeometry,
} from '../core/geoUtils.js';

const AXIS = { x: 0, y: 1, z: 2 };
const DEG = Math.PI / 180;

// ------------------------------------------------------------- geo.displace

define('geo.displace', (ctx, inputs) => {
  const g = inputs.geometry;
  if (!g || !g.getAttribute('position')) {
    ctx.error('Displace needs a shape plugged into Geometry.');
    return { out: null };
  }
  const amount = inputs.amount;
  const axis = inputs.axis || 'normal';

  const out = g.clone();

  // Constant zero displacement is a no-op — hand the geometry straight on.
  if (ctx.isConstField(amount) && ctx.constValueOf(amount) === 0) return { out };

  // The amount field sees the mesh's bounds, so gradients normalise properly.
  const fctx = fieldCtxFor(out, ctx.fieldCtx);
  const pos = out.getAttribute('position');
  let nrm = null;
  if (axis === 'normal') {
    ensureNormals(out);
    nrm = out.getAttribute('normal');
  }
  const bounds = boundsInfo(out);

  for (let idx = 0; idx < pos.count; idx++) {
    const x = pos.getX(idx);
    const y = pos.getY(idx);
    const z = pos.getZ(idx);
    const d = ctx.sample(amount, x, y, z, fctx, 0);
    if (d === 0) continue;

    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (axis === 'normal') {
      dx = nrm.getX(idx);
      dy = nrm.getY(idx);
      dz = nrm.getZ(idx);
    } else if (axis === 'radial') {
      const rx = x - bounds.center[0];
      const ry = y - bounds.center[1];
      const rz = z - bounds.center[2];
      const len = Math.hypot(rx, ry, rz);
      if (len > 1e-8) {
        dx = rx / len;
        dy = ry / len;
        dz = rz / len;
      }
    } else if (axis === 'x') dx = 1;
    else if (axis === 'y') dy = 1;
    else dz = 1;

    pos.setXYZ(idx, x + dx * d, y + dy * d, z + dz * d);
  }
  pos.needsUpdate = true;

  // Pushing along the existing normals keeps shading plausible; every other
  // direction changes the surface enough that the normals must be rebuilt.
  if (axis !== 'normal') out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return { out };
});

// --------------------------------------------------------------- geo.twist

define('geo.twist', (ctx, inputs) => {
  const g = inputs.geometry;
  if (!g || !g.getAttribute('position')) {
    ctx.error('Twist needs a shape plugged into Geometry.');
    return { out: null };
  }
  const out = g.clone();
  const pos = out.getAttribute('position');
  const b = boundsInfo(out);

  const a = AXIS[inputs.axis] ?? 1; // the axis we twist *along*
  const u = (a + 1) % 3;
  const v = (a + 2) % 3;
  const sizeA = b.size[a] || 1;
  const total = (Number(inputs.angle) || 0) * DEG;
  const pivot = b.min[a] + (Number(inputs.center) || 0) * sizeA;

  const arr = pos.array;
  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    // 0 at the pivot, ±0.5 across the object by default → total twist = angle.
    const t = (arr[o + a] - pivot) / sizeA;
    const ang = total * t;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const du = arr[o + u] - b.center[u];
    const dv = arr[o + v] - b.center[v];
    arr[o + u] = b.center[u] + du * c - dv * s;
    arr[o + v] = b.center[v] + du * s + dv * c;
  }
  pos.needsUpdate = true;
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return { out };
});

// ---------------------------------------------------------------- geo.bend

define('geo.bend', (ctx, inputs) => {
  const g = inputs.geometry;
  if (!g || !g.getAttribute('position')) {
    ctx.error('Bend needs a shape plugged into Geometry.');
    return { out: null };
  }
  const out = g.clone();

  const a = AXIS[inputs.axis] ?? 1; // the axis the "ruler" extends along
  const bIdx = (a + 1) % 3; // the direction it curls towards
  const b = boundsInfo(out);
  const sizeA = b.size[a] || 1;
  const pivot = b.min[a] + (Number(inputs.center) || 0) * sizeA;
  const curvature = ((Number(inputs.angle) || 0) * DEG) / sizeA;

  if (Math.abs(curvature) < 1e-6) return { out }; // flat is a no-op

  const R0 = 1 / curvature; // bend radius; negative angle curls the other way
  const centerB = b.center[bIdx];
  const pos = out.getAttribute('position');
  const arr = pos.array;

  for (let i = 0; i < pos.count; i++) {
    const o = i * 3;
    const h = arr[o + a] - pivot; // distance along the ruler
    const d = arr[o + bIdx] - centerB; // offset from the neutral fibre
    const theta = curvature * h;
    const R = R0 - d; // distance from the curl centre
    arr[o + a] = pivot + R * Math.sin(theta);
    arr[o + bIdx] = centerB + R0 - R * Math.cos(theta);
  }
  pos.needsUpdate = true;
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return { out };
});

// ------------------------------------------------------------- geo.transform

define('geo.transform', (ctx, inputs) => {
  const g = inputs.geometry;
  if (!g || !g.getAttribute('position')) {
    ctx.error('Transform needs a shape plugged into Geometry.');
    return { out: null };
  }
  const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
  const out = transformGeometry(g, {
    pos: [num(inputs.posX, 0), num(inputs.posY, 0), num(inputs.posZ, 0)],
    rot: [num(inputs.rotX, 0) * DEG, num(inputs.rotY, 0) * DEG, num(inputs.rotZ, 0) * DEG],
    scale: [num(inputs.scaleX, 1), num(inputs.scaleY, 1), num(inputs.scaleZ, 1)],
  });
  return { out };
});

// ---------------------------------------------------------------- geo.merge

define('geo.merge', (ctx, inputs) => {
  const parts = (inputs.parts || []).filter((p) => p && p.getAttribute && p.getAttribute('position'));
  if (!parts.length) {
    ctx.error('Merge needs at least one shape plugged into Parts.');
    return { out: null };
  }
  const out = mergeGeometryList(parts);
  if (!out) {
    ctx.error('Merge could not combine those shapes.');
    return { out: null };
  }
  return { out };
});

// --------------------------------------------------------------- geo.refine

define('geo.refine', (ctx, inputs) => {
  const g = inputs.geometry;
  if (!g || !g.getAttribute('position')) {
    ctx.error('Refine needs a shape plugged into Geometry.');
    return { out: null };
  }
  const levels = Math.max(0, Math.min(3, Math.round(Number(inputs.levels) || 0)));
  let out = refineGeometry(g, levels);
  // "Soften" welds split vertices' positions together, easing any faceting.
  if (inputs.smooth) out = smoothPositions(out, 0.35);
  return { out };
});
