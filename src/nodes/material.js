/**
 * Material nodes — and the single place THREE materials get created.
 *
 * The nodes here only build a *descriptor*:
 *
 *   { kind, params, colorField, emissiveField, sizeField }
 *
 * `params` holds plain values (colours as '#rrggbb'); the `*Field` members are
 * set only when the matching colour input is a *varying* field. The output
 * node bakes varying fields into geometry attributes, then asks
 * `buildThreeMaterial()` for the real THREE material, passing flags describing
 * exactly what was baked:
 *
 *   { emissiveAttr, vertexColors, pointSizes }
 */
import * as THREE from 'three';
import { define } from './define.js';

const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);

/** Colour ports arrive raw: hex string, {r,g,b}, or a (possibly varying) field. */
function splitColor(ctx, v, fallbackHex) {
  if (ctx.isFn(v) && !ctx.isConstField(v)) return { hex: fallbackHex, field: v };
  return { hex: ctx.toHex(v), field: null };
}

// ------------------------------------------------------------ the nodes

define('material.standard', (ctx, i) => {
  const col = splitColor(ctx, i.color, '#e8e8f0');
  const emi = splitColor(ctx, i.emissive, '#000000');
  return {
    out: {
      kind: 'standard',
      params: {
        color: col.hex,
        roughness: num(i.roughness, 0.45),
        metalness: num(i.metalness, 0.05),
        emissive: emi.hex,
        emissiveIntensity: num(i.emissiveIntensity, 1),
        flatShading: !!i.flatShading,
        side: i.side || 'front',
        wireframe: !!i.wireframe,
        opacity: num(i.opacity, 1),
        transparent: !!i.transparent,
      },
      colorField: col.field,
      emissiveField: emi.field,
      sizeField: null,
    },
  };
});

define('material.physical', (ctx, i) => {
  const col = splitColor(ctx, i.color, '#e8e8f0');
  const emi = splitColor(ctx, i.emissive, '#000000');
  return {
    out: {
      kind: 'physical',
      params: {
        color: col.hex,
        roughness: num(i.roughness, 0.2),
        metalness: num(i.metalness, 0.1),
        clearcoat: num(i.clearcoat, 0),
        clearcoatRoughness: num(i.clearcoatRoughness, 0.1),
        transmission: num(i.transmission, 0),
        ior: num(i.ior, 1.5),
        iridescence: num(i.iridescence, 0),
        emissive: emi.hex,
        emissiveIntensity: num(i.emissiveIntensity, 1),
        side: i.side || 'front',
        opacity: num(i.opacity, 1),
      },
      colorField: col.field,
      emissiveField: emi.field,
      sizeField: null,
    },
  };
});

define('material.toon', (ctx, i) => {
  const col = splitColor(ctx, i.color, '#ffd166');
  const emi = splitColor(ctx, i.emissive, '#000000');
  return {
    out: {
      kind: 'toon',
      params: {
        color: col.hex,
        steps: int(i.steps, 2, 16, 5),
        emissive: emi.hex,
        emissiveIntensity: num(i.emissiveIntensity, 1),
        side: i.side || 'front',
        opacity: num(i.opacity, 1),
      },
      colorField: col.field,
      emissiveField: emi.field,
      sizeField: null,
    },
  };
});

define('material.basic', (ctx, i) => {
  const col = splitColor(ctx, i.color, '#7dd3fc');
  return {
    out: {
      kind: 'basic',
      params: {
        color: col.hex,
        wireframe: !!i.wireframe,
        side: i.side || 'front',
        opacity: num(i.opacity, 1),
      },
      colorField: col.field,
      emissiveField: null, // unlit shaders have nowhere to put a glow
      sizeField: null,
    },
  };
});

define('material.normal', (ctx, i) => ({
  out: {
    kind: 'normal',
    params: { flatShading: !!i.flatShading, side: i.side || 'front' },
    colorField: null,
    emissiveField: null,
    sizeField: null,
  },
}));

define('material.points', (ctx, i) => {
  const col = splitColor(ctx, i.color, '#7dd3fc');
  const sizeBy = i.sizeBy;
  const varyingSize = ctx.isFn(sizeBy) && !ctx.isConstField(sizeBy);
  return {
    out: {
      kind: 'points',
      params: {
        size: num(i.size, 0.035),
        color: col.hex,
        shape: i.shape || 'circle',
        softness: num(i.softness, 0.35),
        opacity: num(i.opacity, 1),
        attenuation: !!i.attenuation,
        depthWrite: !!i.depthWrite,
      },
      colorField: col.field,
      emissiveField: null,
      sizeField: varyingSize ? sizeBy : null,
    },
  };
});

function int(v, lo, hi, fb) {
  const n = Math.round(num(v, fb));
  return n < lo ? lo : n > hi ? hi : n;
}

// ================================================== buildThreeMaterial()

const SIDES = { back: THREE.BackSide, double: THREE.DoubleSide };

/** Stepped gradient map for MeshToonMaterial, cached per band count. */
const GRADIENTS = new Map();
function toonGradient(steps) {
  const n = int(steps, 2, 16, 5);
  const hit = GRADIENTS.get(n);
  if (hit) return hit;
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.round((i / (n - 1)) * 255);
  const tex = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  GRADIENTS.set(n, tex);
  return tex;
}

/**
 * Consume the baked `aEmissive` attribute: add it to the shader's emissive
 * term so per-vertex glow composes with the (usually black) emissive uniform.
 */
function patchEmissive(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute vec3 aEmissive;\nvarying vec3 vEmissive;\n' +
      shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvEmissive = aEmissive;'
      );
    shader.fragmentShader = 'varying vec3 vEmissive;\n' + shader.fragmentShader;
    if (shader.fragmentShader.includes('#include <emissivemap_fragment>')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vEmissive;'
      );
    } else if (shader.fragmentShader.includes('#include <color_fragment>')) {
      // Guard: some shaders lack the emissive include entirely.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ntotalEmissiveRadiance += vEmissive;'
      );
    }
  };
}

/**
 * Turn a material descriptor into the THREE material the renderer draws.
 *
 * @param descriptor  { kind, params, colorField, emissiveField, sizeField }
 * @param flags       { emissiveAttr, vertexColors, pointSizes } — what the
 *                    output node actually baked into the geometry.
 */
export function buildThreeMaterial(descriptor = {}, flags = {}) {
  const kind = descriptor.kind || 'standard';
  const p = descriptor.params || {};
  const { emissiveAttr = false, vertexColors = false, pointSizes = false } = flags;

  if (kind === 'points') return buildPointsMaterial(p, { vertexColors, pointSizes });

  const side = SIDES[p.side] || THREE.FrontSide;
  const opacity = num(p.opacity, 1);
  const transparent = !!p.transparent || opacity < 0.999;
  // Vertex colours multiply the base colour; the emissive patch relies on the
  // same USE_COLOR path, so emissiveAttr implies vertexColors (the output node
  // guarantees the `color` attribute exists whenever either flag is set).
  const common = { side, opacity, transparent, vertexColors: emissiveAttr || vertexColors };

  let mat;
  switch (kind) {
    case 'physical':
      mat = new THREE.MeshPhysicalMaterial({
        ...common,
        color: p.color || '#e8e8f0',
        roughness: num(p.roughness, 0.2),
        metalness: num(p.metalness, 0.1),
        clearcoat: num(p.clearcoat, 0),
        clearcoatRoughness: num(p.clearcoatRoughness, 0.1),
        transmission: num(p.transmission, 0),
        ior: num(p.ior, 1.5),
        iridescence: num(p.iridescence, 0),
        emissive: p.emissive || '#000000',
        emissiveIntensity: num(p.emissiveIntensity, 1),
      });
      break;
    case 'toon':
      mat = new THREE.MeshToonMaterial({
        ...common,
        color: p.color || '#ffd166',
        emissive: p.emissive || '#000000',
        emissiveIntensity: num(p.emissiveIntensity, 1),
        gradientMap: toonGradient(p.steps),
      });
      break;
    case 'basic':
      mat = new THREE.MeshBasicMaterial({ ...common, color: p.color || '#7dd3fc', wireframe: !!p.wireframe });
      break;
    case 'normal':
      mat = new THREE.MeshNormalMaterial({ ...common, flatShading: !!p.flatShading });
      break;
    case 'standard':
    default:
      mat = new THREE.MeshStandardMaterial({
        ...common,
        color: p.color || '#e8e8f0',
        roughness: num(p.roughness, 0.45),
        metalness: num(p.metalness, 0.05),
        emissive: p.emissive || '#000000',
        emissiveIntensity: num(p.emissiveIntensity, 1),
        flatShading: !!p.flatShading,
        wireframe: !!p.wireframe,
      });
      break;
  }

  // Only lit shaders carry `totalEmissiveRadiance`; unlit ones skip the patch.
  if (emissiveAttr && (kind === 'standard' || kind === 'physical' || kind === 'toon')) {
    patchEmissive(mat);
  }
  return mat;
}

// ================================================== points ShaderMaterial

const SHAPE_ID = { circle: 0, square: 1, diamond: 2, cross: 3 };

const POINTS_VERT = /* glsl */ `
uniform float uSize;
uniform float uAttenuation;
#ifdef USE_POINT_SIZE
attribute float aSize;
#endif
#ifdef USE_COLOR
varying vec3 vColor;
#endif
#include <fog_pars_vertex>

void main() {
	#ifdef USE_COLOR
	vColor = color; // the "color" attribute is declared by three's prefix
	#endif

	vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

	float size = uSize;
	#ifdef USE_POINT_SIZE
	size *= aSize;
	#endif

	if (uAttenuation > 0.5) {
		size *= 300.0 / max(-mvPosition.z, 0.001); // world-ish sizing
	} else {
		size *= 300.0 / 6.0; // fixed size at the default camera distance
	}
	gl_PointSize = max(size, 1.0);

	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

const POINTS_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uShape;
uniform float uSoftness;
uniform float uOpacity;
#ifdef USE_COLOR
varying vec3 vColor;
#endif
#include <fog_pars_fragment>

void main() {
	vec2 p = gl_PointCoord * 2.0 - 1.0;

	// Radial-ish distance to the shape boundary: 1.0 sits exactly on the edge.
	float d;
	if (uShape < 0.5) {
		d = length(p); // circle
	} else if (uShape < 1.5) {
		d = max(abs(p.x), abs(p.y)); // square
	} else if (uShape < 2.5) {
		d = abs(p.x) + abs(p.y); // diamond
	} else {
		// Plus / cross, via a small signed-distance estimate normalised so the
		// centre reads 0 and the arm tips read 1.
		float dx = abs(p.x);
		float dy = abs(p.y);
		float sdf = min(max(dx - 0.9, dy - 0.22), max(dy - 0.9, dx - 0.22));
		d = 1.0 + sdf / 0.22;
	}

	// Softness widens the antialiased rim — 0 still gets a thin AA edge.
	float edge = mix(0.08, 1.0, clamp(uSoftness, 0.0, 1.0));
	float alpha = (1.0 - smoothstep(1.0 - edge, 1.0, d)) * uOpacity;
	if (alpha < 0.004) discard;

	vec3 col = uColor;
	#ifdef USE_COLOR
	col *= vColor;
	#endif

	gl_FragColor = vec4(col, alpha);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment> // mirror the built-in shaders: fog after encoding
}
`;

function buildPointsMaterial(p, { vertexColors = false, pointSizes = false } = {}) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog, // fogColor / fogNear / fogFar / fogDensity
    {
      uSize: { value: 1 },
      uColor: { value: new THREE.Color('#ffffff') },
      uShape: { value: 0 },
      uSoftness: { value: 0.35 },
      uOpacity: { value: 1 },
      uAttenuation: { value: 1 },
      uDepthWrite: { value: 1 },
    },
  ]);
  uniforms.uSize.value = num(p.size, 0.035);
  uniforms.uColor.value.set(p.color || '#7dd3fc'); // #rrggbb → linear working space
  uniforms.uShape.value = SHAPE_ID[p.shape] ?? 0;
  uniforms.uSoftness.value = num(p.softness, 0.35);
  uniforms.uOpacity.value = num(p.opacity, 1);
  uniforms.uAttenuation.value = p.attenuation === false ? 0 : 1;
  uniforms.uDepthWrite.value = p.depthWrite === false ? 0 : 1;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    transparent: true, // the soft rim always blends, even at full opacity
    depthWrite: p.depthWrite !== false, // uDepthWrite mirrors this on the GPU
    depthTest: true,
    fog: true, // picks up scene fog through USE_FOG / FOG_EXP2
    vertexColors, // lets three declare `attribute vec3 color` for us
    defines: pointSizes ? { USE_POINT_SIZE: '' } : {},
  });
  return mat;
}
