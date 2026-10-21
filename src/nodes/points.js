/**
 * Particle nodes — point clouds ready for the Points Material.
 *
 * Each node produces a plain payload (see core/points.js): typed arrays of
 * positions (+ optional colours/sizes). Randomness flows through `ctx.rngFor`
 * so the same graph and seed always scatter the exact same cloud.
 */
import { define } from './define.js';
import { makePoints } from '../core/points.js';
import { fieldCtxFor } from '../core/geoUtils.js';

const int = (v, lo, hi, fb) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? (n < lo ? lo : n > hi ? hi : n) : fb;
};
const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------ points.scatter

define('points.scatter', (ctx, inputs) => {
  const g = inputs.geometry;
  if (!g || !g.getAttribute('position')) {
    ctx.error('Scatter needs a shape plugged into Geometry.');
    return { out: null };
  }
  const count = int(inputs.count, 1, 200000, 5000);
  const jitter = clamp01(num(inputs.jitter, 0));
  const density = inputs.density;
  const rng = ctx.rngFor(inputs.seed | 0);
  const fctx = fieldCtxFor(g, ctx.fieldCtx);

  // --- cumulative triangle areas → uniform-over-the-surface sampling -----
  const pos = g.getAttribute('position');
  const src = pos.array;
  const index = g.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vi = index ? (k) => index.getX(k) : (k) => k;
  const cum = new Float64Array(triCount);
  let total = 0;
  for (let t = 0; t < triCount; t++) {
    const a = vi(t * 3) * 3;
    const b = vi(t * 3 + 1) * 3;
    const c = vi(t * 3 + 2) * 3;
    const abx = src[b] - src[a];
    const aby = src[b + 1] - src[a + 1];
    const abz = src[b + 2] - src[a + 2];
    const acx = src[c] - src[a];
    const acy = src[c + 1] - src[a + 1];
    const acz = src[c + 2] - src[a + 2];
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    total += 0.5 * Math.hypot(cx, cy, cz);
    cum[t] = total;
  }
  if (!(total > 0)) {
    ctx.error('That shape has no surface area to scatter on.');
    return { out: null };
  }

  const positions = new Float32Array(count * 3);
  const spacing = Math.sqrt(total / count); // typical gap between kept points
  const maxAttempts = Math.min(count * 60 + 1000, 2000000);
  let kept = 0;
  let attempts = 0;

  while (kept < count && attempts < maxAttempts) {
    attempts++;
    // Area-weighted triangle pick (binary search over the cumulative table).
    const r = rng() * total;
    let lo = 0;
    let hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    const a = vi(lo * 3) * 3;
    const b = vi(lo * 3 + 1) * 3;
    const c = vi(lo * 3 + 2) * 3;
    let u = rng();
    let v = rng();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v; // fold the mirrored barycentric pair back into the triangle
    }
    let x = src[a] + u * (src[b] - src[a]) + v * (src[c] - src[a]);
    let y = src[a + 1] + u * (src[b + 1] - src[a + 1]) + v * (src[c + 1] - src[a + 1]);
    let z = src[a + 2] + u * (src[b + 2] - src[a + 2]) + v * (src[c + 2] - src[a + 2]);

    // Density gate: keep the point when the field beats a fresh dice roll,
    // which makes acceptance probability exactly equal to the field value.
    if (ctx.sample(density, x, y, z, fctx, 1) < rng()) continue;

    if (jitter > 0) {
      const j = jitter * spacing;
      x += (rng() - 0.5) * 2 * j;
      y += (rng() - 0.5) * 2 * j;
      z += (rng() - 0.5) * 2 * j;
    }
    const o = kept * 3;
    positions[o] = x;
    positions[o + 1] = y;
    positions[o + 2] = z;
    kept++;
  }

  if (kept === 0) {
    ctx.warn('Scatter kept no points — the Density field rejected everything. Raise Density or lower Count.');
  }
  return { out: makePoints(positions.slice(0, kept * 3)) };
});

// ------------------------------------------------------------- points.volume

define('points.volume', (ctx, inputs) => {
  const w = Math.abs(num(inputs.width, 2));
  const h = Math.abs(num(inputs.height, 2));
  const d = Math.abs(num(inputs.depth, 2));
  const attempts = int(inputs.count, 1, 300000, 12000);
  const density = inputs.density;
  const threshold = clamp01(num(inputs.threshold, 0.1));
  const rng = ctx.rngFor(inputs.seed | 0);

  // A field context covering the box so gradients normalise across it.
  const fctx = {
    ...ctx.fieldCtx,
    min: [-w / 2, -h / 2, -d / 2],
    max: [w / 2, h / 2, d / 2],
    size: [w, h, d],
    center: [0, 0, 0],
    radius: 0.5 * Math.hypot(w, h, d),
  };

  const kept = [];
  for (let n = 0; n < attempts; n++) {
    const x = (rng() - 0.5) * w;
    const y = (rng() - 0.5) * h;
    const z = (rng() - 0.5) * d;
    if (ctx.sample(density, x, y, z, fctx, 1) >= threshold) kept.push(x, y, z);
  }
  if (!kept.length) {
    ctx.warn('Fill Volume kept no points — the Density field is below the Threshold everywhere.');
  }
  return { out: makePoints(Float32Array.from(kept)) };
});

// --------------------------------------------------------------- points.grid

define('points.grid', (ctx, inputs) => {
  const w = Math.abs(num(inputs.width, 2));
  const h = Math.abs(num(inputs.height, 2));
  const d = Math.abs(num(inputs.depth, 2));
  const nx = int(inputs.nx, 1, 160, 24);
  const ny = int(inputs.ny, 1, 160, 24);
  const nz = int(inputs.nz, 1, 160, 24);
  const density = inputs.density;
  const jitter = clamp01(num(inputs.jitter, 0));
  const rng = ctx.rngFor(inputs.seed | 0);

  const cells = nx * ny * nz;
  if (cells > 1000000) {
    ctx.warn(`This grid holds ${cells.toLocaleString()} points — evaluation may feel slow.`);
  }

  const fctx = {
    ...ctx.fieldCtx,
    min: [-w / 2, -h / 2, -d / 2],
    max: [w / 2, h / 2, d / 2],
    size: [w, h, d],
    center: [0, 0, 0],
    radius: 0.5 * Math.hypot(w, h, d),
  };

  const positions = new Float32Array(cells * 3);
  let kept = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = nx > 1 ? -w / 2 + (ix / (nx - 1)) * w : 0;
        const y = ny > 1 ? -h / 2 + (iy / (ny - 1)) * h : 0;
        const z = nz > 1 ? -d / 2 + (iz / (nz - 1)) * d : 0;
        const jx = jitter > 0 ? (rng() - 0.5) * jitter * (w / nx) : 0;
        const jy = jitter > 0 ? (rng() - 0.5) * jitter * (h / ny) : 0;
        const jz = jitter > 0 ? (rng() - 0.5) * jitter * (d / nz) : 0;
        const px = x + jx;
        const py = y + jy;
        const pz = z + jz;
        if (ctx.sample(density, px, py, pz, fctx, 1) < rng()) continue;
        const o = kept * 3;
        positions[o] = px;
        positions[o + 1] = py;
        positions[o + 2] = pz;
        kept++;
      }
    }
  }
  if (kept === 0) {
    ctx.warn('Point Grid kept no points — the Density field rejected everything.');
  }
  return { out: makePoints(positions.slice(0, kept * 3)) };
});
