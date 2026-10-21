/**
 * Scene and light nodes.
 *
 * Everything here produces plain specs (see core/sceneSpec.js), never THREE
 * objects — the renderer interprets them. Light nodes output a single
 * `{ kind: 'light' }` spec; `light.preset` outputs an *array* of them, which
 * the output node flattens.
 */
import { define } from './define.js';
import {
  makeCamera,
  makeFog,
  makeLightPreset,
  makeSky,
} from '../core/sceneSpec.js';

// ---------------------------------------------------------------- scene.sky

define('scene.sky', (ctx, inputs) => ({
  out: makeSky({
    mode: inputs.mode || 'environment',
    environment: inputs.environment || 'studio',
    color: ctx.toHex(inputs.color),
    color2: ctx.toHex(inputs.color2),
    angle: Number(inputs.angle) || 0,
    envIntensity: Number(inputs.envIntensity),
    blur: Number(inputs.blur),
  }),
}));

// ---------------------------------------------------------------- scene.fog

define('scene.fog', (ctx, inputs) => {
  // "Off" is better expressed as *no fog spec at all* — the output node and
  // the renderer both treat null as "skip".
  if ((inputs.mode || 'off') === 'off') return { out: null };
  return {
    out: makeFog({
      mode: inputs.mode,
      color: ctx.toHex(inputs.color),
      near: Number(inputs.near),
      far: Number(inputs.far),
      density: Number(inputs.density),
    }),
  };
});

// -------------------------------------------------------------- scene.camera

define('scene.camera', (ctx, inputs) => ({
  out: makeCamera({
    distance: Number(inputs.distance),
    fov: Number(inputs.fov),
    targetY: Number(inputs.targetY),
    autoRotate: !!inputs.autoRotate,
    speed: Number(inputs.speed),
  }),
}));

// --------------------------------------------------------------- light.* ----

define('light.preset', (ctx, inputs) => ({
  out: makeLightPreset(inputs.preset || 'studio', Number(inputs.intensity)),
}));

define('light.ambient', (ctx, inputs) => ({
  out: {
    kind: 'light',
    light: 'ambient',
    color: ctx.toHex(inputs.color),
    intensity: Number(inputs.intensity) || 0,
  },
}));

define('light.directional', (ctx, inputs) => ({
  out: {
    kind: 'light',
    light: 'directional',
    color: ctx.toHex(inputs.color),
    intensity: Number(inputs.intensity) || 0,
    position: [Number(inputs.x) || 0, Number(inputs.y) || 0, Number(inputs.z) || 0],
    castShadow: !!inputs.castShadow,
  },
}));

define('light.point', (ctx, inputs) => ({
  out: {
    kind: 'light',
    light: 'point',
    color: ctx.toHex(inputs.color),
    intensity: Number(inputs.intensity) || 0,
    position: [Number(inputs.x) || 0, Number(inputs.y) || 0, Number(inputs.z) || 0],
    distance: Number(inputs.distance) || 0,
    decay: Number.isFinite(Number(inputs.decay)) ? Number(inputs.decay) : 2,
    castShadow: !!inputs.castShadow,
  },
}));

define('light.hemi', (ctx, inputs) => ({
  out: {
    kind: 'light',
    light: 'hemi',
    color: ctx.toHex(inputs.sky),
    groundColor: ctx.toHex(inputs.ground),
    intensity: Number(inputs.intensity) || 0,
  },
}));
