/**
 * Export helpers for the preview: high-resolution screenshots and glTF/GLB.
 *
 * Screenshots temporarily resize the WebGL drawing buffer to
 * cssSize × pixelRatio × scale (clamped to the GPU limit), render once into
 * it and grab the canvas with toBlob. The previous size is always restored.
 *
 * glTF export clones the artwork into a fresh group (so the live scene is
 * never touched) plus a small subset of the lights, and falls back to
 * MeshStandardMaterial for anything the exporter cannot digest (the points
 * shader material, for instance).
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createExportLight } from './lights.js';

const HARD_BUFFER_CAP = 8192;

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Capture the current view.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLCanvasElement} canvas
 * @param {{ scale?: number, type?: string }} opts
 * @returns {Promise<Blob>}
 */
export async function captureScreenshot(renderer, scene, camera, canvas, opts = {}) {
  const scale = Math.max(0.1, Number(opts.scale) || 1);
  const type = opts.type || 'image/png';

  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (!cssW || !cssH) {
    throw new Error('The preview has no size yet — make it visible before exporting.');
  }

  const gl = renderer.getContext();
  let maxBuffer = HARD_BUFFER_CAP;
  try {
    maxBuffer = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || HARD_BUFFER_CAP, HARD_BUFFER_CAP);
  } catch {
    /* keep the conservative cap */
  }

  const pr = renderer.getPixelRatio();
  let targetW = Math.round(cssW * pr * scale);
  let targetH = Math.round(cssH * pr * scale);

  // Clamp oversized buffers (4× on a dense display can blow past GPU limits).
  const longest = Math.max(targetW, targetH);
  if (longest > maxBuffer) {
    const f = maxBuffer / longest;
    targetW = Math.max(1, Math.floor(targetW * f));
    targetH = Math.max(1, Math.floor(targetH * f));
    console.warn(
      `[preview] screenshot clamped to ${targetW}×${targetH} (GPU limit ${maxBuffer}px).`,
    );
  }

  const size = renderer.getSize(new THREE.Vector2());

  renderer.setPixelRatio(1);
  renderer.setSize(targetW, targetH, false);
  try {
    // Let the resize actually land before we render into the new buffer.
    await nextFrame();
    const blob = await new Promise((resolve, reject) => {
      // Render and capture in one task: with preserveDrawingBuffer:false the
      // buffer is invalidated at the next composite, so they must be adjacent.
      try {
        renderer.render(scene, camera);
      } catch (err) {
        reject(err);
        return;
      }
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('The browser could not capture the preview canvas.'))),
        type,
      );
    });
    return blob;
  } finally {
    renderer.setPixelRatio(pr);
    renderer.setSize(size.x, size.y, false);
  }
}

// --------------------------------------------------------------- gltf export

function isUnsupportedMaterial(m) {
  if (!m) return true;
  if (m.isShaderMaterial || m.isRawShaderMaterial) return true;
  return !(
    m.isMeshStandardMaterial ||
    m.isMeshBasicMaterial ||
    m.isMeshPhongMaterial ||
    m.isMeshLambertMaterial ||
    m.isPointsMaterial ||
    m.isLineBasicMaterial ||
    m.isLineDashedMaterial
  );
}

/** Best-effort colour rescue from a shader material's uniforms. */
function colorFromShaderMaterial(material, target) {
  const u = material && material.uniforms;
  const candidates = ['uColor', 'uDiffuse', 'uBaseColor', 'color', 'diffuse'];
  if (u) {
    for (const name of candidates) {
      const entry = u[name];
      if (entry && entry.value && entry.value.isColor) return target.copy(entry.value);
    }
  }
  if (material && material.color && material.color.isColor) return target.copy(material.color);
  return target.set('#c8ccd4');
}

function makeFallbackMaterial(material) {
  const color = new THREE.Color();
  colorFromShaderMaterial(material, color);
  return new THREE.MeshStandardMaterial({
    name: material.name || 'export-fallback',
    color,
    roughness: 0.6,
    metalness: 0.05,
    transparent: !!material.transparent,
    opacity: Number.isFinite(material.opacity) ? material.opacity : 1,
    side: material.side ?? THREE.FrontSide,
    vertexColors: !!material.vertexColors,
    flatShading: !!material.flatShading,
  });
}

/**
 * Swap un-exportable materials on the *clone* for MeshStandardMaterial.
 * Clones share material references with the live artwork, so we only ever
 * re-point fields on the clone — never mutate a material in place.
 */
function sanitizeMaterials(root, owned, force = false) {
  root.traverse((obj) => {
    if (!obj.material) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    let changed = false;
    const next = list.map((m) => {
      const bad = force ? !m.isMeshStandardMaterial : isUnsupportedMaterial(m);
      if (!bad) return m;
      changed = true;
      const fallback = makeFallbackMaterial(m);
      owned.push(fallback);
      return fallback;
    });
    if (changed) obj.material = Array.isArray(obj.material) ? next : next[0];
  });
}

const _box = new THREE.Box3();

function centerOf(object) {
  _box.makeEmpty();
  try {
    _box.setFromObject(object);
  } catch {
    /* degenerate geometry — fall through */
  }
  if (_box.isEmpty() || !Number.isFinite(_box.min.x)) return new THREE.Vector3();
  return _box.getCenter(new THREE.Vector3());
}

/**
 * Export the artwork (plus lights) as a glTF/GLB Blob.
 *
 * @param {THREE.Object3D} object  the live artwork — will be cloned
 * @param {Array} lightSpecs       plain light specs from the scene spec
 * @param {{ binary?: boolean }} opts
 * @returns {Promise<Blob>}
 */
export async function exportSceneGLTF(object, lightSpecs, opts = {}) {
  const binary = opts.binary !== false;
  if (!object) throw new Error('There is no artwork to export yet.');

  const group = new THREE.Group();
  group.name = 'FluxForgeArtwork';

  let clone;
  try {
    clone = object.clone(true);
  } catch (err) {
    throw new Error(`Could not clone the artwork for export: ${err && err.message ? err.message : err}`);
  }
  if (!clone.name) clone.name = 'artwork';

  const owned = [];
  sanitizeMaterials(clone, owned);
  group.add(clone);

  const center = centerOf(clone);
  for (const spec of Array.isArray(lightSpecs) ? lightSpecs : []) {
    try {
      const light = createExportLight(spec, center);
      if (light) group.add(light);
    } catch (err) {
      console.warn('[preview] skipped a light during glTF export', err);
    }
  }

  const exporter = new GLTFExporter();
  let result;
  try {
    result = await exporter.parseAsync(group, { binary });
  } catch (firstErr) {
    // Second chance: replace everything non-standard and retry once.
    sanitizeMaterials(clone, owned, true);
    try {
      result = await exporter.parseAsync(group, { binary });
    } catch (err) {
      throw new Error(`glTF export failed: ${err && err.message ? err.message : err}`);
    }
  } finally {
    // The clone shares geometry with the live artwork — only dispose the
    // fallback materials this export created.
    for (const m of owned) m.dispose();
  }

  if (binary) {
    const buffer = result instanceof ArrayBuffer ? result : new Uint8Array(result).buffer;
    return new Blob([buffer], { type: 'model/gltf-binary' });
  }
  return new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' });
}
