/**
 * Deterministic procedural noise.
 *
 * Every function here is pure and seeded, so the same graph always renders the
 * same artwork. Fields are sampled on the CPU (never in a shader) which keeps
 * displacement and colouring perfectly in sync — a bump in the surface always
 * lines up with a bump in the pattern.
 */

// ---------------------------------------------------------------- hashing

/** Fast 32-bit integer hash -> [0,1). Deterministic, order independent. */
export function hash1(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash3(x, y, z, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b9) ^ Math.imul(seed | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash4(x, y, z, w, seed = 0) {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(z | 0, 0x9e3779b9) ^
    Math.imul(w | 0, 0x85ebca6b) ^
    Math.imul(seed | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic generator factory. */
export function makeRng(seed = 1) {
  let s = (Math.trunc(seed) || 1) >>> 0;
  return function rng() {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// --------------------------------------------------------------- perlin 3D

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);

function grad3(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * Build a seeded 3D gradient-noise sampler.
 * Returns `(x, y, z) => ~[-1, 1]`.
 */
export function makeNoise(seed = 0) {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  const rng = makeRng(seed || 1);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  return function noise3(x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    x -= xi;
    y -= yi;
    z -= zi;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);

    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;

    const l = (a, b, t) => a + t * (b - a);
    return l(
      l(
        l(grad3(p[AA], x, y, z), grad3(p[BA], x - 1, y, z), u),
        l(grad3(p[AB], x, y - 1, z), grad3(p[BB], x - 1, y - 1, z), u),
        v
      ),
      l(
        l(grad3(p[AA + 1], x, y, z - 1), grad3(p[BA + 1], x - 1, y, z - 1), u),
        l(grad3(p[AB + 1], x, y - 1, z - 1), grad3(p[BB + 1], x - 1, y - 1, z - 1), u),
        v
      ),
      w
    );
  };
}

// --------------------------------------------------------------- perlin 4D

/**
 * The 32 gradients of 4-D Perlin noise: every permutation of
 * (0, ±1, ±1, ±1). Stored flat as [gx, gy, gz, gw, …]; length √3 each.
 */
const GRAD4 = new Float64Array([
  0, 1, 1, 1, 0, 1, 1, -1, 0, 1, -1, 1, 0, 1, -1, -1,
  0, -1, 1, 1, 0, -1, 1, -1, 0, -1, -1, 1, 0, -1, -1, -1,
  1, 0, 1, 1, 1, 0, 1, -1, 1, 0, -1, 1, 1, 0, -1, -1,
  -1, 0, 1, 1, -1, 0, 1, -1, -1, 0, -1, 1, -1, 0, -1, -1,
  1, 1, 0, 1, 1, 1, 0, -1, 1, -1, 0, 1, 1, -1, 0, -1,
  -1, 1, 0, 1, -1, 1, 0, -1, -1, -1, 0, 1, -1, -1, 0, -1,
  1, 1, 1, 0, 1, 1, -1, 0, 1, -1, 1, 0, 1, -1, -1, 0,
  -1, 1, 1, 0, -1, 1, -1, 0, -1, -1, 1, 0, -1, -1, -1, 0,
]);

function grad4(hash, x, y, z, w) {
  const i = (hash & 31) << 2;
  return GRAD4[i] * x + GRAD4[i + 1] * y + GRAD4[i + 2] * z + GRAD4[i + 3] * w;
}

/**
 * Measured gain: raw 4-D output ran ~11% wider than the 3-D sampler
 * (std 0.296 vs 0.265, peaks ±1.09 vs ±0.89), so scale it down to keep the
 * two interchangeable — displacement amounts and the ridged/billow modes
 * assume the same ~[-1, 1] envelope either way.
 */
const NOISE4_GAIN = 0.9;

/**
 * Build a seeded 4-D gradient-noise sampler.
 * Returns `(x, y, z, w) => ~[-1, 1]`.
 *
 * W is a genuine fourth spatial dimension, not a time parameter: sliding
 * along it morphs the pattern in place — nearby slices correlate smoothly,
 * distant ones are unrelated — which is exactly what makes it worth
 * animating with Keyframes.
 */
export function makeNoise4(seed = 0) {
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  const rng = makeRng(seed || 1);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];

  return function noise4(x, y, z, w) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const wi = Math.floor(w);
    const X = xi & 255;
    const Y = yi & 255;
    const Z = zi & 255;
    const W = wi & 255;
    x -= xi;
    y -= yi;
    z -= zi;
    w -= wi;
    const u = fade(x);
    const v = fade(y);
    const s = fade(z);
    const t = fade(w);

    // Hash of one hypercube corner: the same chained lookup as the 3-D
    // version, extended through W.
    const g = (ox, oy, oz, ow) =>
      grad4(p[p[p[p[X + ox] + Y + oy] + Z + oz] + W + ow], x - ox, y - oy, z - oz, w - ow);

    // 16 corners, then interpolate x → y → z → w.
    const c0 = g(0, 0, 0, 0), c1 = g(1, 0, 0, 0), c2 = g(0, 1, 0, 0), c3 = g(1, 1, 0, 0);
    const c4 = g(0, 0, 1, 0), c5 = g(1, 0, 1, 0), c6 = g(0, 1, 1, 0), c7 = g(1, 1, 1, 0);
    const c8 = g(0, 0, 0, 1), c9 = g(1, 0, 0, 1), c10 = g(0, 1, 0, 1), c11 = g(1, 1, 0, 1);
    const c12 = g(0, 0, 1, 1), c13 = g(1, 0, 1, 1), c14 = g(0, 1, 1, 1), c15 = g(1, 1, 1, 1);

    const x0 = lerp(c0, c1, u), x1 = lerp(c2, c3, u);
    const x2 = lerp(c4, c5, u), x3 = lerp(c6, c7, u);
    const x4 = lerp(c8, c9, u), x5 = lerp(c10, c11, u);
    const x6 = lerp(c12, c13, u), x7 = lerp(c14, c15, u);

    const y0 = lerp(x0, x1, v), y1 = lerp(x2, x3, v);
    const y2 = lerp(x4, x5, v), y3 = lerp(x6, x7, v);

    const z0 = lerp(y0, y1, s), z1 = lerp(y2, y3, s);

    return lerp(z0, z1, t) * NOISE4_GAIN;
  };
}

// ------------------------------------------------------------------ variants

const NOISE_MODES = new Set(['smooth', 'ridged', 'billow', 'white']);

/**
 * Fractal noise with selectable character.
 *
 * @param noise  seeded sampler from makeNoise() / makeNoise4()
 * @param opts   { scale, octaves, persistence, lacunarity, seed, mode, w }
 *               `w` is the optional 4th coordinate: when finite it is passed
 *               through (scaled per octave, exactly like x/y/z) so a 4-D
 *               sampler can be swept through W. Omit it and the 3-D path is
 *               followed unchanged.
 * @returns ~[-1, 1] for the fractal modes, [0,1] for `white`
 */
export function fbm(noise, x, y, z, opts = {}) {
  const scale = opts.scale === undefined ? 1 : opts.scale;
  const octaves = Math.max(1, Math.min(12, Math.round(opts.octaves ?? 4)));
  const persistence = opts.persistence ?? 0.5;
  const lacunarity = opts.lacunarity ?? 2;
  const mode = opts.mode && NOISE_MODES.has(opts.mode) ? opts.mode : 'smooth';
  const w = opts.w;
  const hasW = w !== undefined && Number.isFinite(w);

  if (mode === 'white') {
    return hasW
      ? hash4(
          Math.floor(x * scale),
          Math.floor(y * scale),
          Math.floor(z * scale),
          Math.floor(w * scale),
          opts.seed ?? 0
        )
      : hash3(Math.floor(x * scale), Math.floor(y * scale), Math.floor(z * scale), opts.seed ?? 0);
  }

  let amp = 1;
  let freq = scale === 0 ? 1 : scale;
  let sum = 0;
  let norm = 0;

  for (let o = 0; o < octaves; o++) {
    let n = hasW ? noise(x * freq, y * freq, z * freq, w * freq) : noise(x * freq, y * freq, z * freq);
    if (mode === 'ridged') n = 1 - Math.abs(n);
    else if (mode === 'billow') n = Math.abs(n) * 2 - 1;
    sum += n * amp;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }

  const v = norm === 0 ? 0 : sum / norm;
  return mode === 'ridged' ? v * 2 - 1 : v;
}

// ------------------------------------------------------------------- voronoi

/**
 * Cellular noise. Returns `{ f1, f2, id }` where distances are in cell units
 * (roughly 0..1.5) and `id` is a stable per-cell hash in [0,1].
 */
export function voronoi(x, y, z, opts = {}) {
  const scale = opts.scale === undefined ? 1 : opts.scale;
  const jitter = opts.jitter === undefined ? 1 : Math.max(0, Math.min(1, opts.jitter));
  const seed = opts.seed ?? 0;

  const px = x * scale;
  const py = y * scale;
  const pz = z * scale;

  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);

  let f1 = Infinity;
  let f2 = Infinity;
  let id = 0;

  for (let k = -1; k <= 1; k++) {
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const cz = iz + k;
        const rx = hash3(cx, cy, cz, seed);
        const ry = hash3(cx, cy, cz, seed ^ 0x5bf03635);
        const rz = hash3(cx, cy, cz, seed ^ 0x27d4eb2f);
        const fx = cx + 0.5 + (rx - 0.5) * jitter;
        const fy = cy + 0.5 + (ry - 0.5) * jitter;
        const fz = cz + 0.5 + (rz - 0.5) * jitter;
        const dx = px - fx;
        const dy = py - fy;
        const dz = pz - fz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = hash3(cx, cy, cz, seed ^ 0x9e3779b9);
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }

  return { f1, f2, id };
}

// -------------------------------------------------------------- misc fields

export const TAU = Math.PI * 2;

export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerpNum(a, b, t) {
  return a + (b - a) * t;
}

export function fract(v) {
  return v - Math.floor(v);
}

/** Signed distance to a plane through `centre` with unit `normal`. */
export function planeDistance(x, y, z, nx, ny, nz, cx, cy, cz) {
  return (x - cx) * nx + (y - cy) * ny + (z - cz) * nz;
}
