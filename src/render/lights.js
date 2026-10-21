/**
 * Light rig for the preview.
 *
 * Turns plain light specs (see core/sceneSpec.js) into three.js lights:
 *
 *   { light: 'ambient'|'directional'|'point'|'hemi'|'spot',
 *     color, intensity, position?, target?, groundColor?,
 *     distance?, decay?, angle?, penumbra?, castShadow? }
 *
 * A directional/spot `position` without an explicit `target` is treated as a
 * *direction from the origin*: the light is placed at artworkCentre + position
 * and aims at the artwork centre, so off-centre artwork still lights sanely.
 *
 * When shadows are requested, each shadow-casting light's ortho shadow camera
 * is fitted to the artwork bounding sphere (with padding) and the map size is
 * pinned to 2048².
 */

import * as THREE from 'three';

const DEFAULT_DIR = new THREE.Vector3(3.4, 5.6, 4.2);
const DEFAULT_POINT_DIR = new THREE.Vector3(3, 2.2, 3);
const SHADOW_MAP_SIZE = 2048;
const SHADOW_PADDING = 1.7;

/** Used when the graph supplies no lights at all — keeps the preview lit. */
export const FALLBACK_LIGHTS = Object.freeze([
  Object.freeze({ kind: 'light', light: 'ambient', color: '#dfe7ff', intensity: 0.5 }),
  Object.freeze({ kind: 'light', light: 'directional', color: '#ffffff', intensity: 2.1, position: [3.6, 5.6, 4] }),
]);

export class LightRig {
  /** @param {THREE.Scene} scene */
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'lights';
    scene.add(this.group);
    this.lights = [];
    this._tmp = new THREE.Vector3();
  }

  /** True when any spec in the last rebuild asked to cast shadows. */
  get wantsShadows() {
    for (const l of this.lights) if (l.userData.fluxShadow) return true;
    return false;
  }

  /**
   * Replace every light. `center` is the artwork centre (directional/spot
   * positions without a target become directions from it).
   */
  rebuild(specs, center) {
    this.clear();
    const list = Array.isArray(specs) && specs.length ? specs : FALLBACK_LIGHTS;
    for (const spec of list) {
      const light = this._make(spec, center);
      if (!light) continue;
      light.userData.fluxShadow = !!spec.castShadow;
      this.lights.push(light);
    }
  }

  _make(spec, center) {
    const color = spec.color || '#ffffff';
    const intensity = Number.isFinite(spec.intensity) ? spec.intensity : 1;
    const tmp = this._tmp;

    switch (spec.light) {
      case 'ambient': {
        const l = new THREE.AmbientLight(color, intensity);
        this.group.add(l);
        return l;
      }
      case 'hemi': {
        const l = new THREE.HemisphereLight(color, spec.groundColor || '#5b5347', intensity);
        this.group.add(l);
        return l;
      }
      case 'point': {
        const l = new THREE.PointLight(color, intensity, spec.distance ?? 0, spec.decay ?? 2);
        if (Array.isArray(spec.position)) l.position.set(spec.position[0], spec.position[1], spec.position[2]);
        else l.position.copy(center).add(DEFAULT_POINT_DIR);
        this.group.add(l);
        return l;
      }
      case 'spot': {
        const l = new THREE.SpotLight(
          color,
          intensity,
          spec.distance ?? 0,
          Number.isFinite(spec.angle) ? spec.angle : Math.PI / 6,
          Number.isFinite(spec.penumbra) ? spec.penumbra : 0.35,
          spec.decay ?? 2,
        );
        const target = new THREE.Object3D();
        target.name = 'spot-target';
        if (Array.isArray(spec.target)) target.position.set(spec.target[0], spec.target[1], spec.target[2]);
        else target.position.copy(center);
        if (Array.isArray(spec.position)) l.position.set(spec.position[0], spec.position[1], spec.position[2]);
        else l.position.copy(center).add(DEFAULT_DIR);
        l.target = target;
        this.group.add(l);
        this.group.add(target);
        return l;
      }
      case 'directional':
      default: {
        const l = new THREE.DirectionalLight(color, intensity);
        const target = new THREE.Object3D();
        target.name = 'light-target';
        if (Array.isArray(spec.target)) {
          target.position.set(spec.target[0], spec.target[1], spec.target[2]);
          if (Array.isArray(spec.position)) l.position.set(spec.position[0], spec.position[1], spec.position[2]);
          else l.position.copy(DEFAULT_DIR);
        } else {
          tmp.set(
            Array.isArray(spec.position) ? spec.position[0] : DEFAULT_DIR.x,
            Array.isArray(spec.position) ? spec.position[1] : DEFAULT_DIR.y,
            Array.isArray(spec.position) ? spec.position[2] : DEFAULT_DIR.z,
          );
          l.position.copy(center).add(tmp);
          target.position.copy(center);
        }
        l.target = target;
        this.group.add(l);
        this.group.add(target);
        return l;
      }
    }
  }

  /**
   * Enable/disable shadow casting across the rig and fit every caster to
   * `sphere` (the artwork bounding sphere). Returns true when shadow maps
   * should be on.
   *
   * @param {boolean} enabled  spec.shadows
   * @param {THREE.Sphere} sphere
   */
  fitShadows(enabled, sphere) {
    const anyCaster = !!enabled && this.wantsShadows;
    for (const light of this.lights) {
      const cast = anyCaster && !!light.userData.fluxShadow;
      light.castShadow = cast;
      if (!cast) continue;

      light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
      if (light.shadow.map) {
        light.shadow.map.dispose();
        light.shadow.map = null; // force re-allocation at the new size
      }
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.03;

      const radius = Math.max(sphere.radius || 0, 0.25) * SHADOW_PADDING;
      const dist = light.position.distanceTo(sphere.center);
      const cam = light.shadow.camera;
      if (cam.isOrthographicCamera) {
        cam.left = -radius;
        cam.right = radius;
        cam.top = radius;
        cam.bottom = -radius;
      }
      cam.near = Math.max(0.05, dist - radius * 3);
      cam.far = Math.max(cam.near + 1, dist + radius * 3);
      cam.updateProjectionMatrix();
    }
    return anyCaster;
  }

  clear() {
    for (const l of this.lights) {
      if (l.shadow && l.shadow.map) {
        l.shadow.map.dispose();
        l.shadow.map = null;
      }
      if (l.target && l.target.parent) l.target.parent.remove(l.target);
      this.group.remove(l);
      if (typeof l.dispose === 'function') l.dispose();
    }
    this.lights.length = 0;
  }

  dispose() {
    this.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

/**
 * Build a standalone, export-ready light from a spec (used by the glTF
 * exporter). Directional/spot lights are oriented so their -Z axis points
 * along the desired direction, which is what glTF's KHR_lights_punctual
 * expects. Returns a light that is NOT attached to any scene.
 *
 * Ambient / hemisphere lights are not expressible in glTF and return null.
 */
export function createExportLight(spec, center) {
  if (!spec || typeof spec.light !== 'string') return null;
  const color = spec.color || '#ffffff';
  const intensity = Number.isFinite(spec.intensity) ? spec.intensity : 1;
  const pos = Array.isArray(spec.position) ? spec.position : null;
  const tgt = Array.isArray(spec.target) ? spec.target : null;

  const dir = new THREE.Vector3();
  const position = new THREE.Vector3();

  if (spec.light === 'point') {
    const l = new THREE.PointLight(color, intensity, spec.distance ?? 0, spec.decay ?? 2);
    if (pos) l.position.set(pos[0], pos[1], pos[2]);
    else l.position.copy(center).add(DEFAULT_POINT_DIR);
    l.name = 'point-light';
    return l;
  }

  if (spec.light !== 'directional' && spec.light !== 'spot') return null; // ambient / hemi

  if (tgt) {
    position.set(pos ? pos[0] : DEFAULT_DIR.x, pos ? pos[1] : DEFAULT_DIR.y, pos ? pos[2] : DEFAULT_DIR.z);
    dir.set(tgt[0], tgt[1], tgt[2]).sub(position);
  } else {
    dir.set(pos ? pos[0] : DEFAULT_DIR.x, pos ? pos[1] : DEFAULT_DIR.y, pos ? pos[2] : DEFAULT_DIR.z);
    position.copy(center).add(dir);
    dir.negate(); // aims back at the centre
  }
  if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
  dir.normalize();

  const l = spec.light === 'spot'
    ? new THREE.SpotLight(
        color,
        intensity,
        spec.distance ?? 0,
        Number.isFinite(spec.angle) ? spec.angle : Math.PI / 6,
        Number.isFinite(spec.penumbra) ? spec.penumbra : 0.35,
        spec.decay ?? 2,
      )
    : new THREE.DirectionalLight(color, intensity);

  l.position.copy(position);
  // glTF lights point along the node's -Z; bake the direction into rotation.
  l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
  l.target = null; // direction lives in the rotation now; avoids exporter warnings
  l.name = `${spec.light}-light`;
  return l;
}
