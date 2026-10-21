/**
 * The Render node — the sink every graph flows into.
 *
 * Collects a geometry and/or a point cloud, a material descriptor and the
 * scene specs, bakes any varying material fields into geometry attributes,
 * and assembles the plain scene description the preview renders:
 *
 *   { object, lights, sky, fog, camera, shadows, exposure, autoFrame, stats }
 */
import * as THREE from 'three';
import { define } from './define.js';
import { buildThreeMaterial } from './material.js';
import { bakeEmissive, bakeVertexColors, fieldCtxFor } from '../core/geoUtils.js';
import { pointsToGeometry, sampleFieldOverPoints } from '../core/points.js';
import {
  DEFAULT_CAMERA,
  DEFAULT_LIGHTS,
  DEFAULT_SKY,
  collectLights,
  pickKind,
} from '../core/sceneSpec.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Fallback descriptors so a graph with no material node still renders nicely.
const DEFAULT_MESH = {
  kind: 'standard',
  params: {
    color: '#e8e8f0',
    roughness: 0.45,
    metalness: 0.05,
    emissive: '#000000',
    emissiveIntensity: 1,
    flatShading: false,
    side: 'front',
    wireframe: false,
    opacity: 1,
    transparent: false,
  },
  colorField: null,
  emissiveField: null,
  sizeField: null,
};

const DEFAULT_POINTS = {
  kind: 'points',
  params: { size: 0.035, color: '#7dd3fc', shape: 'circle', softness: 0.35, opacity: 1, attenuation: true, depthWrite: true },
  colorField: null,
  emissiveField: null,
  sizeField: null,
};

/** Meshes want a non-points material; inherit the colour of whatever arrived. */
function meshDescriptor(ctx, mat) {
  if (!mat) return DEFAULT_MESH;
  if (mat.kind !== 'points') return mat;
  ctx.warn('Render: a Points Material was plugged in next to a mesh — using its colour with a Standard Material instead.');
  return {
    ...DEFAULT_MESH,
    params: { ...DEFAULT_MESH.params, color: mat.params?.color || DEFAULT_MESH.params.color },
    colorField: mat.colorField || null,
  };
}

/** Points want a points material; inherit the colour of whatever arrived. */
function pointsDescriptor(ctx, mat) {
  if (!mat) return DEFAULT_POINTS;
  if (mat.kind === 'points') return mat;
  ctx.warn('Render: a surface Material was plugged in next to Points — using its colour with a Points Material instead.');
  return {
    ...DEFAULT_POINTS,
    params: { ...DEFAULT_POINTS.params, color: mat.params?.color || DEFAULT_POINTS.params.color },
    colorField: mat.colorField || null,
  };
}

/** Bounds context for a point cloud (used when baking per-point fields). */
function pointsFrame(ctx, payload) {
  const p = payload.positions;
  const n = payload.count || 0;
  if (!n) return { ...ctx.fieldCtx, min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0], radius: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  return {
    ...ctx.fieldCtx,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size,
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    radius: 0.5 * Math.hypot(size[0], size[1], size[2]),
  };
}

define('output.render', (ctx, inputs) => {
  const root = new THREE.Group();
  root.name = 'artwork'; // the renderer's GLTF export looks for this name
  const stats = { triangles: 0, points: 0, vertices: 0 };

  const geometry = inputs.geometry && inputs.geometry.getAttribute ? inputs.geometry : null;
  const points = inputs.points && inputs.points.positions ? inputs.points : null;
  const material = inputs.material || null;

  if (!geometry && !points) {
    ctx.error('Render has nothing to show yet — plug a Shape into Geometry (or a particle cloud into Points).');
  }

  // ------------------------------------------------------------------ mesh
  if (geometry) {
    const mat = meshDescriptor(ctx, material);
    let geo = geometry;
    const flags = { emissiveAttr: false, vertexColors: false };

    if (mat.colorField) {
      // Never write into the cached geometry — bake on a clone.
      geo = geometry.clone();
      bakeVertexColors(geo, mat.colorField, fieldCtxFor(geo, ctx.fieldCtx));
      flags.vertexColors = true;
    }
    if (mat.emissiveField) {
      if (geo === geometry) geo = geometry.clone();
      // Bake the glow scaled by Glow strength; values above 1 saturate because
      // vertex attributes clamp to 0..1.
      const gain = Number.isFinite(Number(mat.params?.emissiveIntensity)) ? Number(mat.params.emissiveIntensity) : 1;
      const src = mat.emissiveField;
      const field =
        gain === 1
          ? src
          : (x, y, z, f) => {
              const c = ctx.sampleColor(src, x, y, z, f);
              return { r: c.r * gain, g: c.g * gain, b: c.b * gain };
            };
      bakeEmissive(geo, field, fieldCtxFor(geo, ctx.fieldCtx));
      flags.emissiveAttr = true;
      // The emissive patch turns on three's vertex-colour path, which needs a
      // `color` attribute or the mesh renders black — fill it with white.
      if (!flags.vertexColors) {
        const n = geo.getAttribute('position').count;
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        flags.vertexColors = true;
      }
    }

    const mesh = new THREE.Mesh(geo, buildThreeMaterial(mat, flags));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);

    const posAttr = geo.getAttribute('position');
    stats.vertices = posAttr ? posAttr.count : 0;
    stats.triangles = geo.index ? Math.floor(geo.index.count / 3) : Math.floor(stats.vertices / 3);
  }

  // ---------------------------------------------------------------- points
  if (points) {
    if (!points.count) {
      ctx.warn('That particle cloud is empty — nothing to draw.');
    } else {
      const mat = pointsDescriptor(ctx, material);
      const fctx = pointsFrame(ctx, points);
      let payload = points;

      if (mat.colorField) {
        const count = payload.count;
        const src = payload.positions;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          // Colours are authored in sRGB 0..1; the GPU wants linear.
          const c = ctx.sampleColor(mat.colorField, src[i * 3], src[i * 3 + 1], src[i * 3 + 2], fctx);
          colors[i * 3] = ctx.srgbToLinear(clamp01(c.r));
          colors[i * 3 + 1] = ctx.srgbToLinear(clamp01(c.g));
          colors[i * 3 + 2] = ctx.srgbToLinear(clamp01(c.b));
        }
        payload = { ...payload, colors }; // copy — the upstream payload is cached
      }
      if (mat.sizeField) {
        const sizes = sampleFieldOverPoints(mat.sizeField, payload.positions, payload.count, fctx, 1);
        if (sizes) payload = { ...payload, sizes };
      }

      const pgeo = pointsToGeometry(payload);
      if (payload.sizes) pgeo.setAttribute('aSize', new THREE.BufferAttribute(payload.sizes, 1));

      const pmat = buildThreeMaterial(mat, {
        vertexColors: !!payload.colors,
        pointSizes: !!payload.sizes,
      });
      root.add(new THREE.Points(pgeo, pmat));
      stats.points = payload.count;
    }
  }

  // ----------------------------------------------------------------- scene
  const lights = collectLights(inputs.lights);
  const scene = {
    object: root,
    lights: lights.length ? lights : DEFAULT_LIGHTS(),
    sky: pickKind(inputs.sky, 'sky') || DEFAULT_SKY(),
    fog: pickKind(inputs.fog, 'fog') || null,
    camera: pickKind(inputs.camera, 'camera') || DEFAULT_CAMERA(),
    shadows: !!inputs.shadows,
    exposure: Number.isFinite(Number(inputs.exposure)) ? Number(inputs.exposure) : 1,
    autoFrame: !!inputs.autoFrame,
    stats,
  };

  return { scene };
});
