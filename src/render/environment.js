/**
 * Procedural environments for the preview.
 *
 * Every environment is painted onto an offscreen equirectangular canvas
 * (2048×1024) — no external image files — and pushed through a
 * THREE.PMREMGenerator so it can drive image-based lighting. Results are
 * cached per preset key (ENVIRONMENTS in core/sceneSpec.js) because PMREM
 * conversion is comparatively expensive.
 *
 * Two-colour gradient backgrounds (sky.mode === 'gradient') are also drawn
 * procedurally, into a small canvas, keyed by their colour/angle triple.
 *
 * createEnvironmentManager(renderer) returns:
 *   envTexture(key)                  -> THREE.Texture | null  (pmrem, null for 'none')
 *   gradientTexture(color, color2, angleDeg) -> THREE.Texture (cached)
 *   dispose()
 */

import * as THREE from 'three';

const ENV_W = 2048;
const ENV_H = 1024;
const GRAD_SIZE = 256;
const GRAD_CACHE_MAX = 16;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ------------------------------------------------------------- paint helpers

function verticalGradient(ctx, h, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

/** Soft radial glow — the workhorse for suns, moons and studio soft-boxes. */
function glow(ctx, x, y, r, inner, mid, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Deterministic PRNG so a preset always paints identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------- the painters

const PAINTERS = {
  /** Neutral soft-box studio: dark cyclorama plus three big area lights. */
  studio(ctx) {
    ctx.fillStyle = verticalGradient(ctx, ENV_H, [
      [0, '#1c1f27'],
      [0.42, '#12141b'],
      [0.5, '#181b24'],
      [0.74, '#0d0f14'],
      [1, '#08090c'],
    ]);
    ctx.fillRect(0, 0, ENV_W, ENV_H);

    // Key soft-box (upper left), fill (right), cool rim (behind).
    glow(ctx, ENV_W * 0.3, ENV_H * 0.24, 540, 'rgba(255,255,255,0.95)', 'rgba(214,226,248,0.34)');
    glow(ctx, ENV_W * 0.72, ENV_H * 0.34, 430, 'rgba(196,210,236,0.6)', 'rgba(140,160,205,0.2)');
    glow(ctx, ENV_W * 0.96, ENV_H * 0.46, 320, 'rgba(165,185,235,0.5)', 'rgba(120,140,195,0.16)');

    // Gentle floor bounce under the horizon.
    ctx.fillStyle = verticalGradient(ctx, ENV_H, [
      [0.5, 'rgba(220,228,244,0)'],
      [0.62, 'rgba(190,200,224,0.10)'],
      [0.8, 'rgba(120,130,155,0.05)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    ctx.fillRect(0, ENV_H * 0.5, ENV_W, ENV_H * 0.5);
  },

  /** Golden hour: violet zenith burning down into orange, sun kissing the horizon. */
  sunset(ctx) {
    ctx.fillStyle = verticalGradient(ctx, ENV_H, [
      [0, '#140a30'],
      [0.28, '#3a1a56'],
      [0.42, '#8a3560'],
      [0.47, '#d1603f'],
      [0.5, '#ff8f3f'],
      [0.53, '#b8502f'],
      [0.66, '#4e2028'],
      [1, '#1d0d18'],
    ]);
    ctx.fillRect(0, 0, ENV_W, ENV_H);

    const sx = ENV_W * 0.38;
    const sy = ENV_H * 0.5;
    glow(ctx, sx, sy, 700, 'rgba(255,238,196,0.85)', 'rgba(255,142,64,0.32)');
    glow(ctx, sx, sy, 90, 'rgba(255,251,230,1)', 'rgba(255,205,128,0.85)');
    // A cooler counter-glow opposite the sun keeps reflections interesting.
    glow(ctx, ENV_W * 0.86, ENV_H * 0.44, 380, 'rgba(180,120,220,0.25)', 'rgba(110,70,170,0.12)');
  },

  /** Deep navy night with a cool moon and a dusting of stars. */
  night(ctx) {
    ctx.fillStyle = verticalGradient(ctx, ENV_H, [
      [0, '#04070f'],
      [0.38, '#0a1230'],
      [0.5, '#101c40'],
      [0.58, '#080e22'],
      [1, '#030509'],
    ]);
    ctx.fillRect(0, 0, ENV_W, ENV_H);

    const rnd = mulberry32(1337);
    ctx.fillStyle = '#e6edff';
    for (let i = 0; i < 420; i++) {
      const x = rnd() * ENV_W;
      const y = rnd() * ENV_H * 0.56;
      const r = rnd() * 1.5 + 0.3;
      ctx.globalAlpha = 0.2 + rnd() * 0.7;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Faint milky-way smudge.
    glow(ctx, ENV_W * 0.22, ENV_H * 0.2, 560, 'rgba(170,190,240,0.10)', 'rgba(110,130,190,0.05)');

    const mx = ENV_W * 0.68;
    const my = ENV_H * 0.16;
    glow(ctx, mx, my, 380, 'rgba(214,228,255,0.8)', 'rgba(110,145,220,0.24)');
    glow(ctx, mx, my, 46, 'rgba(242,247,255,1)', 'rgba(205,220,252,0.9)');
  },

  /** Warm desert air: cream sky over rolling sand. */
  dunes(ctx) {
    ctx.fillStyle = verticalGradient(ctx, ENV_H, [
      [0, '#9dbfdd'],
      [0.26, '#d9dcd0'],
      [0.43, '#f3d8ab'],
      [0.5, '#f8e4bd'],
      [0.56, '#e3b67e'],
      [0.72, '#c08e5a'],
      [1, '#87633e'],
    ]);
    ctx.fillRect(0, 0, ENV_W, ENV_H);

    glow(ctx, ENV_W * 0.28, ENV_H * 0.3, 420, 'rgba(255,247,216,0.85)', 'rgba(255,216,152,0.26)');
    // Heat haze along the horizon.
    ctx.fillStyle = verticalGradient(ctx, ENV_H, [
      [0.46, 'rgba(255,244,220,0)'],
      [0.5, 'rgba(255,240,210,0.22)'],
      [0.56, 'rgba(214,166,110,0.10)'],
      [0.7, 'rgba(0,0,0,0)'],
    ]);
    ctx.fillRect(0, ENV_H * 0.44, ENV_W, ENV_H * 0.3);
  },

  /** Muted forest: pale canopy light, green haze, dark undergrowth. */
  forest(ctx) {
    ctx.fillStyle = verticalGradient(ctx, ENV_H, [
      [0, '#c6d5c9'],
      [0.3, '#9fb6a4'],
      [0.45, '#7b9880'],
      [0.5, '#678a6c'],
      [0.6, '#4d6c4d'],
      [0.8, '#31452e'],
      [1, '#1c291b'],
    ]);
    ctx.fillRect(0, 0, ENV_W, ENV_H);

    // Dappled light through the canopy.
    glow(ctx, ENV_W * 0.4, ENV_H * 0.16, 460, 'rgba(236,244,208,0.6)', 'rgba(190,210,160,0.2)');
    glow(ctx, ENV_W * 0.8, ENV_H * 0.24, 340, 'rgba(220,236,196,0.4)', 'rgba(170,196,150,0.15)');

    // Soft trunk silhouettes near the horizon band.
    const rnd = mulberry32(77);
    ctx.fillStyle = '#16240f';
    for (let i = 0; i < 30; i++) {
      const x = rnd() * ENV_W;
      const w = 8 + rnd() * 28;
      ctx.globalAlpha = 0.05 + rnd() * 0.12;
      ctx.fillRect(x, ENV_H * 0.28, w, ENV_H * 0.28);
    }
    ctx.globalAlpha = 1;
  },
};

// ------------------------------------------------------------------ manager

export function createEnvironmentManager(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    pmrem.compileEquirectangularShader();
  } catch {
    /* older/newer three builds compile lazily — not fatal */
  }

  const envCache = new Map(); // key -> THREE.WebGLRenderTarget
  const gradCache = new Map(); // key -> THREE.CanvasTexture

  function paintCanvas(painter) {
    const canvas = document.createElement('canvas');
    canvas.width = ENV_W;
    canvas.height = ENV_H;
    const ctx = canvas.getContext('2d');
    painter(ctx);
    return canvas;
  }

  function buildEnv(key) {
    const painter = PAINTERS[key] || PAINTERS.studio;
    let canvas = null;
    let tex = null;
    try {
      canvas = paintCanvas(painter);
      tex = new THREE.CanvasTexture(canvas);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const rt = pmrem.fromEquirectangular(tex);
      envCache.set(key, rt);
      return rt;
    } catch (err) {
      console.warn('[preview] could not build environment', key, err);
      envCache.set(key, null); // remember the failure; do not retry every frame
      return null;
    } finally {
      // The render target owns its own copy now; the source canvas texture
      // would only leak GPU memory.
      if (tex) tex.dispose();
    }
  }

  /** pmrem texture for a preset key, or null for 'none'/failure. */
  function envTexture(key) {
    if (!key || key === 'none') return null;
    if (!envCache.has(key)) buildEnv(key);
    const rt = envCache.get(key);
    return rt ? rt.texture : null;
  }

  /** Two-colour linear gradient used as a plain background texture. */
  function gradientTexture(color, color2, angle) {
    const a = ((Number(angle) || 0) % 360 + 360) % 360;
    const key = `${color || '#000000'}|${color2 || '#000000'}|${a}`;
    const hit = gradCache.get(key);
    if (hit) return hit;

    const canvas = document.createElement('canvas');
    canvas.width = GRAD_SIZE;
    canvas.height = GRAD_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(GRAD_SIZE / 2, GRAD_SIZE / 2);
    ctx.rotate(a * DEG);
    ctx.translate(-GRAD_SIZE / 2, -GRAD_SIZE / 2);
    const g = ctx.createLinearGradient(0, 0, 0, GRAD_SIZE);
    g.addColorStop(0, color || '#000000');
    g.addColorStop(1, color2 || '#000000');
    ctx.fillStyle = g;
    // Overfill so the rotated corners still cover the quad.
    ctx.fillRect(-GRAD_SIZE, -GRAD_SIZE, GRAD_SIZE * 3, GRAD_SIZE * 3);
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    if (gradCache.size >= GRAD_CACHE_MAX) {
      const oldest = gradCache.keys().next().value;
      const old = gradCache.get(oldest);
      if (old) old.dispose();
      gradCache.delete(oldest);
    }
    gradCache.set(key, tex);
    return tex;
  }

  function dispose() {
    for (const rt of envCache.values()) {
      if (rt && typeof rt.dispose === 'function') rt.dispose();
    }
    envCache.clear();
    for (const tex of gradCache.values()) {
      if (tex) tex.dispose();
    }
    gradCache.clear();
    pmrem.dispose();
  }

  return { envTexture, gradientTexture, dispose, hasPreset: (key) => !!PAINTERS[key] };
}
