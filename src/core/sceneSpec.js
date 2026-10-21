/**
 * Scene setting specifications.
 *
 * Scene nodes produce plain data (no THREE objects) so graphs serialise
 * cleanly and the renderer stays the only place that touches the WebGL
 * context. The output node collects these and the preview interprets them.
 *
 *   { kind: 'sky',    mode, environment, color, color2, angle, envIntensity, blur }
 *   { kind: 'fog',    mode, color, near, far, density }
 *   { kind: 'camera', distance, fov, targetY, autoRotate, speed }
 *   { kind: 'light',  light: 'ambient'|'directional'|'point'|'hemi'|'spot', … }
 *
 * The rendered scene is:
 *   { object, lights, sky, fog, camera, shadows, exposure, autoFrame, stats }
 */

export const ENVIRONMENTS = ['studio', 'sunset', 'night', 'dunes', 'forest', 'none'];

const L = (light, extra) => ({ kind: 'light', light, color: '#ffffff', intensity: 1, ...extra });

export const LIGHT_PRESETS = {
  studio: () => [
    L('ambient', { color: '#dfe7ff', intensity: 0.45 }),
    L('directional', { color: '#ffffff', intensity: 2.3, position: [4.5, 6.5, 4], castShadow: true }),
    L('directional', { color: '#bcd2ff', intensity: 0.85, position: [-5, 1.5, -4] }),
  ],
  dramatic: () => [
    L('ambient', { color: '#2a3550', intensity: 0.35 }),
    L('directional', { color: '#fff3d6', intensity: 3.4, position: [6, 4, 1.5], castShadow: true }),
    L('directional', { color: '#4d7dff', intensity: 1.1, position: [-4, -1, -5] }),
  ],
  soft: () => [
    L('ambient', { color: '#ffffff', intensity: 0.9 }),
    L('hemi', { color: '#dff0ff', groundColor: '#7a6a55', intensity: 1.1 }),
    L('directional', { color: '#ffffff', intensity: 1.1, position: [2, 5, 6], castShadow: true }),
  ],
  sunset: () => [
    L('ambient', { color: '#5a3a52', intensity: 0.5 }),
    L('directional', { color: '#ff9d5c', intensity: 3.2, position: [5, 1.5, -3], castShadow: true }),
    L('directional', { color: '#ffd7a1', intensity: 0.9, position: [-4, 3, 4] }),
  ],
  night: () => [
    L('ambient', { color: '#1b2545', intensity: 0.5 }),
    L('directional', { color: '#9fc0ff', intensity: 1.7, position: [-3, 7, -4], castShadow: true }),
    L('point', { color: '#7aa2ff', intensity: 6, position: [3, -1, 3] }),
  ],
  neon: () => [
    L('ambient', { color: '#241038', intensity: 0.4 }),
    L('point', { color: '#ff2fa0', intensity: 34, position: [3.5, 1.5, 2.5] }),
    L('point', { color: '#2ff0ff', intensity: 34, position: [-3.5, -1, 2] }),
    L('point', { color: '#9b5cff', intensity: 26, position: [0, 3.5, -3] }),
    L('directional', { color: '#ffffff', intensity: 0.8, position: [2, 6, 5] }),
  ],
  clay: () => [
    L('ambient', { color: '#ffffff', intensity: 0.7 }),
    L('directional', { color: '#ffffff', intensity: 2.4, position: [4, 6, 4], castShadow: true }),
    L('directional', { color: '#ffffff', intensity: 0.8, position: [-5, 2, -4] }),
  ],
  none: () => [],
};

export function makeLightPreset(name, intensity = 1) {
  const build = LIGHT_PRESETS[name] || LIGHT_PRESETS.studio;
  const k = Number.isFinite(intensity) ? intensity : 1;
  return build().map((spec) => ({ ...spec, intensity: spec.intensity * k }));
}

export function makeSky(spec = {}) {
  return {
    kind: 'sky',
    mode: spec.mode || 'environment',
    environment: ENVIRONMENTS.includes(spec.environment) ? spec.environment : 'studio',
    color: spec.color || '#0b1020',
    color2: spec.color2 || '#24365e',
    angle: Number(spec.angle) || 0,
    envIntensity: Number.isFinite(spec.envIntensity) ? spec.envIntensity : 1,
    blur: Number.isFinite(spec.blur) ? spec.blur : 0,
  };
}

export function makeFog(spec = {}) {
  return {
    kind: 'fog',
    mode: ['off', 'linear', 'exponential'].includes(spec.mode) ? spec.mode : 'off',
    color: spec.color || '#c9d6e8',
    near: Number.isFinite(spec.near) ? spec.near : 6,
    far: Number.isFinite(spec.far) ? spec.far : 40,
    density: Number.isFinite(spec.density) ? spec.density : 0.03,
  };
}

export function makeCamera(spec = {}) {
  return {
    kind: 'camera',
    distance: Number.isFinite(spec.distance) ? spec.distance : 6,
    fov: Number.isFinite(spec.fov) ? spec.fov : 45,
    targetY: Number.isFinite(spec.targetY) ? spec.targetY : 0,
    autoRotate: !!spec.autoRotate,
    speed: Number.isFinite(spec.speed) ? spec.speed : 1,
  };
}

export function isLight(spec) {
  return spec && spec.kind === 'light' && typeof spec.light === 'string';
}

/** Flatten any mix of single light specs and arrays into one list. */
export function collectLights(values) {
  const out = [];
  const visit = (v) => {
    if (!v) return;
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (isLight(v)) out.push(v);
  };
  (Array.isArray(values) ? values : [values]).forEach(visit);
  return out;
}

/** Pick the first spec of a given kind from a port value. */
export function pickKind(value, kind) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = pickKind(v, kind);
      if (found) return found;
    }
    return null;
  }
  return value.kind === kind ? value : null;
}

export const DEFAULT_SKY = () => makeSky({ mode: 'environment', environment: 'studio', envIntensity: 1 });
export const DEFAULT_CAMERA = () => makeCamera({ distance: 6, fov: 45, autoRotate: false });
export const DEFAULT_LIGHTS = () => makeLightPreset('studio', 1);
