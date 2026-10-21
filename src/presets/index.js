/**
 * Preset gallery — seventeen ready-made artworks, each a complete node graph.
 *
 * The app loads the preset with id 'starter' on first run, and the preset
 * modal (press P) builds a fresh graph from `preset.graph()` on every click,
 * so each entry here must produce a brand-new document each call (makeGraph
 * guarantees that).
 *
 * Every graph is authored with the tuple DSL in ./dsl.js:
 *   nodes: [type, x, y, params?, title?]
 *   links: [fromIndex, fromPort, toIndex, toPort]
 * and every type / port key is checked against src/core/manifest.js.
 *
 * Presets cover the engine's three output modes:
 *   sculpture  — displaced meshes (starter, facets, twistbox, …)
 *   patterns   — fields baked into vertex colours (poster, knot, …)
 *   particles  — point clouds with Points Materials (neon-volume, …)
 */

import { makeGraph } from './dsl.js';
import { TESTCARD } from './testcard.js';

// -------------------------------------------------------------------- helpers

/** Stops for color.ramp: [[t, '#hex'], …] -> [{ t, c }, …]. */
const ramp = (...stops) => stops.map(([t, c]) => ({ t, c }));

export const PRESETS = [
  // =============================================================== 1. STARTER
  {
    id: 'starter',
    title: 'Ripple Sphere',
    blurb: 'A wobbly sphere painted with a vivid gradient — the classic first artwork.',
    color: '#7b2ff7',
    category: 'sculpture',
    nodes: 9,
    graph: () =>
      makeGraph({
        name: 'Ripple Sphere',
        nodes: [
          ['shape.sphere', 0, 180, { radius: 1.35, segX: 160, segY: 120 }], // 0
          ['field.noise', 440, -80, { scale: 1.1, octaves: 5, seed: 4 }], // 1 sculpt
          ['geo.displace', 880, 60, { amount: 0.4 }], // 2
          ['field.noise', 440, 420, { scale: 1.9, octaves: 4, seed: 12, range: 'positive' }], // 3 paint
          ['color.ramp', 880, 460, {
            stops: ramp([0, '#150a3d'], [0.45, '#7b2ff7'], [0.8, '#f107a3'], [1, '#ffcf6b']),
          }], // 4
          ['material.standard', 1320, 120, { roughness: 0.35, metalness: 0.1 }], // 5
          ['scene.sky', 1760, -180, { mode: 'environment', environment: 'studio', envIntensity: 1.1 }], // 6
          ['light.preset', 1760, 260, { preset: 'studio', intensity: 1.1 }], // 7
          ['output.render', 2200, 60, { exposure: 1.05, autoFrame: 1 }], // 8
        ],
        links: [
          [0, 'out', 2, 'geometry'],
          [1, 'out', 2, 'amount'],
          [2, 'out', 8, 'geometry'],
          [3, 'out', 4, 'value'],
          [4, 'out', 5, 'color'],
          [5, 'out', 8, 'material'],
          [6, 'out', 8, 'sky'],
          [7, 'out', 8, 'lights'],
        ],
        groups: [
          { title: 'Shape', color: '#a78bfa', nodes: [0] },
          { title: 'Sculpt', note: 'Noise pushes every vertex in or out along its normal.', color: '#8b5cf6', nodes: [1, 2] },
          { title: 'Colour', note: 'A second noise paints a gradient into the vertices.', color: '#fb7185', nodes: [3, 4, 5] },
          { title: 'Scene', color: '#2dd4bf', nodes: [6, 7] },
          { title: 'Output', color: '#f43f5e', nodes: [8] },
        ],
      }),
  },

  // ================================================================ 2. TERRAIN
  {
    id: 'terrain',
    title: 'Ridgeline',
    blurb: 'A mountain range whose colours come from height: grass, rock, then snow.',
    color: '#6b8f3d',
    category: 'landscape',
    nodes: 10,
    graph: () =>
      makeGraph({
        name: 'Ridgeline',
        nodes: [
          ['shape.plane', 0, 160, { width: 3.6, height: 3.6, segX: 220, segY: 220 }], // 0
          ['field.noise', 440, -100, {
            scale: 0.5, octaves: 6, persistence: 0.48, mode: 'ridged', range: 'positive', seed: 23,
          }], // 1
          ['geo.displace', 880, 60, { amount: 1.15, axis: 'normal' }], // 2
          ['geo.transform', 1280, 60, { rotX: -90 }], // 3 lay the sheet flat
          ['field.gradient', 440, 420, { axis: 'y', start: 0.05, end: 1.05, clamp: 1 }], // 4 height
          ['color.ramp', 880, 440, {
            stops: ramp([0, '#3e6b2f'], [0.3, '#6b8f3d'], [0.5, '#8a7457'], [0.72, '#9c9186'], [0.9, '#e9edf2'], [1, '#ffffff']),
          }], // 5
          ['material.standard', 1280, 460, { roughness: 0.85, metalness: 0 }], // 6
          ['scene.sky', 1720, 120, { mode: 'environment', environment: 'dunes', envIntensity: 1 }], // 7
          ['light.preset', 1720, 560, { preset: 'sunset', intensity: 1.15 }], // 8
          ['output.render', 2160, 300, { exposure: 1, autoFrame: 1 }], // 9
        ],
        links: [
          [0, 'out', 2, 'geometry'],
          [1, 'out', 2, 'amount'],
          [2, 'out', 3, 'geometry'],
          [3, 'out', 9, 'geometry'],
          [4, 'out', 5, 'value'],
          [5, 'out', 6, 'color'],
          [6, 'out', 9, 'material'],
          [7, 'out', 9, 'sky'],
          [8, 'out', 9, 'lights'],
        ],
        groups: [
          { title: 'Terrain', note: 'Ridged noise lifts a flat sheet into mountains.', color: '#8b5cf6', nodes: [0, 1, 2, 3] },
          { title: 'Colour by height', note: 'A vertical gradient picks grass, rock or snow.', color: '#fb7185', nodes: [4, 5, 6] },
          { title: 'Scene', color: '#2dd4bf', nodes: [7, 8] },
          { title: 'Output', color: '#f43f5e', nodes: [9] },
        ],
      }),
  },

  // =================================================================== 3. BLOB
  {
    id: 'blob',
    title: 'Melted Blob',
    blurb: 'A pill melted by domain-warped noise into a soft organic blob.',
    color: '#2fbf9b',
    category: 'organic',
    nodes: 12,
    graph: () =>
      makeGraph({
        name: 'Melted Blob',
        nodes: [
          ['shape.capsule', 0, 300, { radius: 0.75, length: 1.7, capSeg: 32, radialSeg: 110 }], // 0
          ['field.noise', 440, -160, { scale: 1.1, octaves: 3, seed: 9, range: 'positive' }], // 1 base lobes
          ['field.noise', 440, 300, { scale: 0.9, octaves: 2, seed: 31 }], // 2 warp driver
          ['field.warp', 840, -40, { amount: 1.5, dy: 0.35 }], // 3 swirl the lobes
          ['field.noise', 840, 420, { scale: 2.8, octaves: 2, seed: 77, range: 'positive' }], // 4 fine detail
          ['math.smin', 1240, 60, { k: 0.6 }], // 5 melt the two patterns together
          ['geo.displace', 1640, 60, { amount: 0.5, axis: 'normal' }], // 6
          ['color.ramp', 1640, 480, {
            stops: ramp([0, '#0d2b26'], [0.5, '#2fbf9b'], [1, '#d8f36b']),
          }], // 7
          ['material.standard', 2040, 340, { roughness: 0.32, metalness: 0.1 }], // 8
          ['light.preset', 2440, -100, { preset: 'soft', intensity: 1.05 }], // 9
          ['scene.sky', 2440, 300, { mode: 'gradient', color: '#0e2a26', color2: '#1f4d3f' }], // 10
          ['output.render', 2840, 80, { exposure: 1, autoFrame: 1 }], // 11
        ],
        links: [
          [0, 'out', 6, 'geometry'],
          [1, 'out', 3, 'value'],
          [2, 'out', 3, 'dx'],
          [3, 'out', 5, 'a'],
          [4, 'out', 5, 'b'],
          [5, 'out', 6, 'amount'],
          [5, 'out', 7, 'value'],
          [6, 'out', 11, 'geometry'],
          [7, 'out', 8, 'color'],
          [8, 'out', 11, 'material'],
          [9, 'out', 11, 'lights'],
          [10, 'out', 11, 'sky'],
        ],
        groups: [
          { title: 'Sculpt', note: 'Smooth Union melts two noise patterns into one blobby field.', color: '#8b5cf6', nodes: [0, 1, 2, 3, 4, 5, 6] },
          { title: 'Colour', note: 'The same field that sculpts also paints.', color: '#fb7185', nodes: [7, 8] },
          { title: 'Scene', color: '#2dd4bf', nodes: [9, 10] },
          { title: 'Output', color: '#f43f5e', nodes: [11] },
        ],
      }),
  },

  // ================================================================= 4. FACETS
  {
    id: 'facets',
    title: 'Gem Facets',
    blurb: 'A faceted gem where every cell gets its own colour, like stained glass.',
    color: '#ff9f1c',
    category: 'sculpture',
    nodes: 9,
    graph: () =>
      makeGraph({
        name: 'Gem Facets',
        nodes: [
          ['shape.ico', 0, 120, { radius: 1.35, detail: 3 }], // 0
          ['field.voronoi', 440, -160, { scale: 4.2, mode: 'cell', range: '01', seed: 5 }], // 1 per-cell colour
          ['field.voronoi', 440, 260, { scale: 4.2, mode: 'edge', range: '01', seed: 5 }], // 2 crack lines
          ['color.ramp', 840, -160, {
            stops: ramp([0, '#1c0b2e'], [0.35, '#e63946'], [0.7, '#ff9f1c'], [1, '#ffe66d']),
          }], // 3
          ['color.blend', 1240, -60, { b: '#14101f', mode: 'mix' }], // 4 darken the cracks
          ['material.standard', 1640, -100, { flatShading: 1, roughness: 0.5, metalness: 0.25 }], // 5
          ['light.preset', 2040, -380, { preset: 'dramatic', intensity: 1.1 }], // 6
          ['scene.sky', 2040, 140, { mode: 'gradient', color: '#0c0a18', color2: '#221535' }], // 7
          ['output.render', 2440, -160, { exposure: 1.05, autoFrame: 1 }], // 8
        ],
        links: [
          [0, 'out', 8, 'geometry'],
          [1, 'out', 3, 'value'],
          [2, 'out', 4, 't'],
          [3, 'out', 4, 'a'],
          [4, 'out', 5, 'color'],
          [5, 'out', 8, 'material'],
          [6, 'out', 8, 'lights'],
          [7, 'out', 8, 'sky'],
        ],
        groups: [
          { title: 'Shape', note: 'An icosphere divides into perfectly even facets.', color: '#a78bfa', nodes: [0] },
          { title: 'Cells', note: 'Cell colour paints each facet; edge cracks outline them.', color: '#38bdf8', nodes: [1, 2] },
          { title: 'Colour', note: 'Flat shading keeps every facet crisp.', color: '#fb7185', nodes: [3, 4, 5] },
          { title: 'Scene', color: '#2dd4bf', nodes: [6, 7] },
          { title: 'Output', color: '#f43f5e', nodes: [8] },
        ],
      }),
  },

  // =================================================================== 5. KNOT
  {
    id: 'knot',
    title: 'Aurora Knot',
    blurb: 'A woven torus knot with aurora stripes swirled around it.',
    color: '#20e3b2',
    category: 'surface',
    nodes: 10,
    graph: () =>
      makeGraph({
        name: 'Aurora Knot',
        nodes: [
          ['shape.knot', 0, 180, { radius: 1.05, tube: 0.34, p: 3, q: 5, seg: 420, tubeSeg: 56 }], // 0
          ['field.position', 440, -160, { axis: 'y', start: -1.5, end: 1.5, clamp: 1 }], // 1 height ramp
          ['field.noise', 440, 300, { scale: 1.5, octaves: 4, seed: 17 }], // 2 swirl driver
          ['field.wave', 840, -160, { waveform: 'triangle', frequency: 5.5, amplitude: 1 }], // 3 stripes
          ['field.warp', 1240, -100, { amount: 0.9, dy: 0.4 }], // 4 bend the stripes
          ['color.ramp', 1640, -100, {
            stops: ramp([0, '#0b1d3a'], [0.3, '#20e3b2'], [0.6, '#7b2ff7'], [1, '#ff5ca8']),
            low: -1, high: 1,
          }], // 5
          ['material.standard', 2040, -160, { roughness: 0.25, metalness: 0.65 }], // 6
          ['light.preset', 2440, -420, { preset: 'neon', intensity: 1 }], // 7
          ['scene.sky', 2440, 0, { mode: 'environment', environment: 'night', envIntensity: 1.2 }], // 8
          ['output.render', 2840, -220, { exposure: 1.1, autoFrame: 1 }], // 9
        ],
        links: [
          [0, 'out', 9, 'geometry'],
          [1, 'out', 3, 'input'],
          [2, 'out', 4, 'dx'],
          [3, 'out', 4, 'value'],
          [4, 'out', 5, 'value'],
          [5, 'out', 6, 'color'],
          [6, 'out', 9, 'material'],
          [7, 'out', 9, 'lights'],
          [8, 'out', 9, 'sky'],
        ],
        groups: [
          { title: 'Shape', color: '#a78bfa', nodes: [0] },
          { title: 'Stripes', note: 'Height becomes stripes, then noise swirls them.', color: '#38bdf8', nodes: [1, 2, 3, 4] },
          { title: 'Colour', color: '#fb7185', nodes: [5, 6] },
          { title: 'Scene', color: '#2dd4bf', nodes: [7, 8] },
          { title: 'Output', color: '#f43f5e', nodes: [9] },
        ],
      }),
  },

  // ========================================================== 6. NEON VOLUME
  {
    id: 'neon-volume',
    title: 'Neon Nebula',
    blurb: 'A glowing cloud of particles carved out of a box by a density field.',
    color: '#ff2fa0',
    category: 'particles',
    nodes: 10,
    graph: () =>
      makeGraph({
        name: 'Neon Nebula',
        nodes: [
          ['field.gradient', 440, -180, { axis: 'radial', start: 0.05, end: 0.9, clamp: 1 }], // 0 ball falloff
          ['math.subtract', 840, -180, { a: 1 }], // 1 dense in the middle
          ['field.noise', 440, 300, { scale: 1.7, octaves: 4, seed: 41, range: 'positive' }], // 2 wisps
          ['math.multiply', 1240, -60], // 3 carve
          ['points.volume', 1640, -60, {
            width: 2.8, height: 2.8, depth: 2.8, count: 90000, threshold: 0.12, seed: 4,
          }], // 4
          ['color.ramp', 1240, 340, {
            stops: ramp([0, '#12053f'], [0.4, '#7b2ff7'], [0.7, '#ff2fa0'], [1, '#41f0ff']),
          }], // 5
          ['material.points', 2040, 80, { size: 0.05, shape: 'circle', softness: 0.55, opacity: 0.95 }], // 6
          ['light.preset', 2440, -320, { preset: 'neon', intensity: 0.8 }], // 7
          ['scene.sky', 2440, 120, { mode: 'gradient', color: '#060314', color2: '#1b0b3a' }], // 8
          ['output.render', 2840, -120, { exposure: 1.15, autoFrame: 1 }], // 9
        ],
        links: [
          [0, 'out', 1, 'b'],
          [1, 'out', 3, 'a'],
          [2, 'out', 3, 'b'],
          [3, 'out', 4, 'density'],
          [3, 'out', 5, 'value'],
          [3, 'out', 6, 'sizeBy'],
          [4, 'out', 9, 'points'],
          [5, 'out', 6, 'color'],
          [6, 'out', 9, 'material'],
          [7, 'out', 9, 'lights'],
          [8, 'out', 9, 'sky'],
        ],
        groups: [
          { title: 'Carve the cloud', note: 'Inside-out ball × noise = a blobby density the points obey.', color: '#38bdf8', nodes: [0, 1, 2, 3] },
          { title: 'Particles', color: '#fb923c', nodes: [4] },
          { title: 'Colour', note: 'The same field sizes and paints every point.', color: '#fb7185', nodes: [5, 6] },
          { title: 'Scene', color: '#2dd4bf', nodes: [7, 8] },
          { title: 'Output', color: '#f43f5e', nodes: [9] },
        ],
      }),
  },

  // =============================================================== 7. SCATTER
  {
    id: 'stardust-torus',
    title: 'Stardust Torus',
    blurb: 'Thousands of dust motes sprinkled over an invisible doughnut.',
    color: '#20c9a6',
    category: 'particles',
    nodes: 10,
    graph: () =>
      makeGraph({
        name: 'Stardust Torus',
        nodes: [
          ['shape.torus', 0, 280, { radius: 1.15, tube: 0.45, radialSeg: 110, tubularSeg: 260 }], // 0
          ['field.noise', 440, -200, { scale: 2.4, octaves: 4, seed: 29, range: 'positive' }], // 1 patches
          ['field.random', 440, 320, { scale: 40, seed: 8 }], // 2 sparkle
          ['math.mix', 840, 40, { t: 0.25 }], // 3 blend the two
          ['points.scatter', 1240, -160, { count: 16000, jitter: 0.4, seed: 12 }], // 4
          ['color.ramp', 1240, 300, {
            stops: ramp([0, '#0a2540'], [0.55, '#20c9a6'], [1, '#ffe08a']),
          }], // 5
          ['material.points', 1640, -40, { size: 0.05, shape: 'circle', softness: 0.6 }], // 6
          ['light.preset', 2040, -360, { preset: 'studio', intensity: 1 }], // 7
          ['scene.sky', 2040, 80, { mode: 'gradient', color: '#050b1c', color2: '#0e2038' }], // 8
          ['output.render', 2440, -180, { exposure: 1, autoFrame: 1 }], // 9
        ],
        links: [
          [0, 'out', 4, 'geometry'],
          [1, 'out', 3, 'a'],
          [2, 'out', 3, 'b'],
          [3, 'out', 4, 'density'],
          [3, 'out', 5, 'value'],
          [3, 'out', 6, 'sizeBy'],
          [4, 'out', 9, 'points'],
          [5, 'out', 6, 'color'],
          [6, 'out', 9, 'material'],
          [7, 'out', 9, 'lights'],
          [8, 'out', 9, 'sky'],
        ],
        groups: [
          { title: 'Shape', color: '#a78bfa', nodes: [0] },
          { title: 'Density', note: 'Noise decides where motes live; a little white noise sparkles.', color: '#38bdf8', nodes: [1, 2, 3] },
          { title: 'Particles', color: '#fb923c', nodes: [4] },
          { title: 'Colour', color: '#fb7185', nodes: [5, 6] },
          { title: 'Scene', color: '#2dd4bf', nodes: [7, 8] },
          { title: 'Output', color: '#f43f5e', nodes: [9] },
        ],
      }),
  },

  // ================================================================= 8. POSTER
  {
    id: 'poster',
    title: 'Riso Poster',
    blurb: 'A flat graphic poster — diagonal stripes checkered against cream, no lighting needed.',
    color: '#ff2e63',
    category: 'graphic',
    nodes: 10,
    graph: () =>
      makeGraph({
        name: 'Riso Poster',
        nodes: [
          ['shape.plane', 0, 180, { width: 3.2, height: 3.2, segX: 96, segY: 96 }], // 0 canvas
          ['field.gradient', 440, -180, { axis: 'diagonal', start: 0, end: 1, clamp: 1 }], // 1
          ['field.wave', 840, -180, { waveform: 'saw', frequency: 9 }], // 2 saw stripes
          ['field.checker', 440, 260, { scale: 7, mode: 'checker' }], // 3
          ['color.blend', 1240, -160, { a: '#ff2e63', b: '#08d9d6', mode: 'mix' }], // 4 striped pair
          ['color.blend', 1640, -80, { b: '#f7f0e0', mode: 'mix' }], // 5 checker over cream
          ['material.basic', 2040, -120, { side: 'double' }], // 6 unlit, pure colour
          ['scene.sky', 2440, -380, { mode: 'gradient', color: '#151528', color2: '#2a1b40' }], // 7
          ['scene.camera', 2440, 60, { distance: 4.4, fov: 40 }], // 8
          ['output.render', 2840, -220, { exposure: 1, autoFrame: 1 }], // 9
        ],
        links: [
          [0, 'out', 9, 'geometry'],
          [1, 'out', 2, 'input'],
          [2, 'out', 4, 't'],
          [3, 'out', 5, 't'],
          [4, 'out', 5, 'a'],
          [5, 'out', 6, 'color'],
          [6, 'out', 9, 'material'],
          [7, 'out', 9, 'sky'],
          [8, 'out', 9, 'camera'],
        ],
        groups: [
          { title: 'Canvas', color: '#a78bfa', nodes: [0] },
          { title: 'Pattern', note: 'A saw wave repeats the diagonal into hard stripes; the checker decides the rest.', color: '#38bdf8', nodes: [1, 2, 3] },
          { title: 'Colour', note: 'Unlit material — the colours are exactly as set.', color: '#fb7185', nodes: [4, 5, 6] },
          { title: 'Scene', color: '#2dd4bf', nodes: [7, 8] },
          { title: 'Output', color: '#f43f5e', nodes: [9] },
        ],
      }),
  },

  // =============================================================== 9. TWISTBOX
  {
    id: 'twistbox',
    title: 'Twisted Monolith',
    blurb: 'A tall box twisted and bent into a metal monolith banded with glowing rings.',
    color: '#c9803f',
    category: 'sculpture',
    nodes: 9,
    graph: () =>
      makeGraph({
        name: 'Twisted Monolith',
        nodes: [
          ['shape.box', 0, 200, { width: 1.2, height: 2.6, depth: 1.2, seg: 56 }], // 0
          ['geo.twist', 440, 80, { angle: 210, axis: 'y', center: 0.5 }], // 1
          ['geo.bend', 840, 80, { angle: 70, axis: 'x', center: 0.45 }], // 2
          ['field.rings', 440, 520, { frequency: 8, softness: 0.35 }], // 3
          ['color.ramp', 1240, 340, {
            stops: ramp([0, '#170f1f'], [0.5, '#c9803f'], [1, '#ffd9a0']),
          }], // 4
          ['material.standard', 1640, 180, { roughness: 0.3, metalness: 0.75 }], // 5
          ['light.preset', 2040, -260, { preset: 'dramatic', intensity: 1.15 }], // 6
          ['scene.sky', 2040, 160, { mode: 'gradient', color: '#0b0913', color2: '#25131f' }], // 7
          ['output.render', 2440, -100, { exposure: 1.05, autoFrame: 1 }], // 8
        ],
        links: [
          [0, 'out', 1, 'geometry'],
          [1, 'out', 2, 'geometry'],
          [2, 'out', 8, 'geometry'],
          [3, 'out', 4, 'value'],
          [4, 'out', 5, 'color'],
          [5, 'out', 8, 'material'],
          [6, 'out', 8, 'lights'],
          [7, 'out', 8, 'sky'],
        ],
        groups: [
          { title: 'Sculpt', note: 'Twist then Bend — deform nodes stack like a chain.', color: '#8b5cf6', nodes: [0, 1, 2] },
          { title: 'Colour', note: 'Concentric rings from the centre, brushed into metal.', color: '#fb7185', nodes: [3, 4, 5] },
          { title: 'Scene', color: '#2dd4bf', nodes: [6, 7] },
          { title: 'Output', color: '#f43f5e', nodes: [8] },
        ],
      }),
  },

  // ================================================================= 10. GLASS
  {
    id: 'glass',
    title: 'Glass Vessel',
    blurb: 'A rippled glass vessel that refracts the sunset gradient behind it.',
    color: '#8fd3ff',
    category: 'material',
    nodes: 8,
    graph: () =>
      makeGraph({
        name: 'Glass Vessel',
        nodes: [
          ['shape.cylinder', 0, 240, {
            radiusTop: 0.5, radiusBottom: 0.9, height: 2.3, radialSeg: 128, heightSeg: 72,
          }], // 0 tapered vessel
          ['field.noise', 440, -180, { scale: 1.9, octaves: 3, seed: 53, range: 'positive' }], // 1
          ['geo.displace', 840, 40, { amount: 0.26, axis: 'normal' }], // 2 hand-blown ripples
          ['material.physical', 1240, -120, {
            color: '#e8f4ff', roughness: 0.06, metalness: 0,
            transmission: 1, ior: 1.45, iridescence: 0.85, clearcoat: 0.55, clearcoatRoughness: 0.12,
          }], // 3
          ['scene.sky', 1640, -360, { mode: 'gradient', color: '#2a1f5e', color2: '#e8705c', angle: 90 }], // 4
          ['light.preset', 1640, 80, { preset: 'studio', intensity: 1.2 }], // 5
          ['scene.camera', 1640, 420, { distance: 5.2, fov: 40 }], // 6
          ['output.render', 2040, -180, { exposure: 1.1, autoFrame: 1 }], // 7
        ],
        links: [
          [0, 'out', 2, 'geometry'],
          [1, 'out', 2, 'amount'],
          [2, 'out', 7, 'geometry'],
          [3, 'out', 7, 'material'],
          [4, 'out', 7, 'sky'],
          [5, 'out', 7, 'lights'],
          [6, 'out', 7, 'camera'],
        ],
        groups: [
          { title: 'Sculpt', note: 'A gentle noise ripple keeps the glass hand-made.', color: '#8b5cf6', nodes: [0, 1, 2] },
          { title: 'Glass', note: 'Transmission bends the sky; iridescence shimmers on top.', color: '#34d399', nodes: [3] },
          { title: 'Scene', color: '#2dd4bf', nodes: [4, 5, 6] },
          { title: 'Output', color: '#f43f5e', nodes: [7] },
        ],
      }),
  },

  // ================================================================ 11. MORPH
  {
    id: 'morph',
    title: 'Chrono Bloom',
    blurb: 'A bloom that never sits still — keyframes morph its 4-D noise, twist it and pulse its glow.',
    color: '#f107a3',
    category: 'animation',
    nodes: 14,
    graph: () =>
      makeGraph({
        name: 'Chrono Bloom',
        nodes: [
          ['input.keyframes', 0, -320, {
            keys: [
              { t: 0, v: 0, ease: 'smooth' },
              { t: 2.5, v: 1.8, ease: 'smooth' },
              { t: 5, v: 0.5, ease: 'smooth' },
            ],
            loop: 'pingpong',
          }], // 0 morph driver → W
          ['input.keyframes', 0, 40, {
            keys: [
              { t: 0, v: 0, ease: 'smooth' },
              { t: 3.5, v: 150, ease: 'smooth' },
              { t: 7, v: 40, ease: 'smooth' },
            ],
            loop: 'pingpong',
          }], // 1 twist driver (a different period, so the motion never repeats exactly)
          ['input.keyframes', 0, 400, {
            keys: [
              { t: 0, v: 0.4, ease: 'smooth' },
              { t: 1.5, v: 2.4, ease: 'smooth' },
              { t: 3, v: 0.4, ease: 'smooth' },
            ],
            loop: 'loop',
          }], // 2 glow pulse
          ['field.noise4', 440, -260, { scale: 1.15, octaves: 4, seed: 7 }], // 3
          ['shape.sphere', 0, 760, { radius: 1.25, segX: 96, segY: 64 }], // 4
          ['geo.twist', 440, 760, {}], // 5
          ['geo.displace', 880, 760, { amount: 0.55 }], // 6
          ['field.voronoi', 440, 1150, { scale: 5, mode: 'edge', range: '01', seed: 5 }], // 7 cracks
          ['color.ramp', 880, 1150, {
            stops: ramp([0, '#160a2e'], [0.45, '#7b2ff7'], [0.75, '#f107a3'], [1, '#ffd9a0']),
          }], // 8
          ['material.standard', 1320, 950, {
            roughness: 0.3, metalness: 0.35, emissive: '#ff5a1f', emissiveIntensity: 1,
          }], // 9
          ['scene.sky', 1760, 560, { mode: 'environment', environment: 'night', envIntensity: 1.1 }], // 10
          ['light.preset', 1760, 960, { preset: 'dramatic', intensity: 1.1 }], // 11
          ['scene.camera', 1760, 1360, { distance: 5, fov: 42, autoRotate: 1, speed: 0.8 }], // 12
          ['output.render', 2200, 860, { exposure: 1.1, autoFrame: 1 }], // 13
        ],
        links: [
          [0, 'out', 3, 'w'],
          [1, 'out', 5, 'angle'],
          [2, 'out', 9, 'emissiveIntensity'],
          [3, 'out', 6, 'amount'],
          [4, 'out', 5, 'geometry'],
          [5, 'out', 6, 'geometry'],
          [6, 'out', 13, 'geometry'],
          [7, 'out', 8, 'value'],
          [8, 'out', 9, 'color'],
          [9, 'out', 13, 'material'],
          [10, 'out', 13, 'sky'],
          [11, 'out', 13, 'lights'],
          [12, 'out', 13, 'camera'],
        ],
        groups: [
          { title: 'Motion', note: 'Three curves on three periods: morph, twist and glow.', color: '#f0b429', nodes: [0, 1, 2] },
          { title: 'Sculpt', note: 'Keyframes sweeps the W axis, so the 4-D noise morphs in place.', color: '#8b5cf6', nodes: [3, 4, 5, 6] },
          { title: 'Colour', note: 'Crack lines painted violet → magenta → gold, with a pulsing ember glow.', color: '#fb7185', nodes: [7, 8, 9] },
          { title: 'Scene', color: '#2dd4bf', nodes: [10, 11, 12] },
          { title: 'Output', color: '#f43f5e', nodes: [13] },
        ],
      }),
  },

  // ========================================================== 12. STILL LIFE
  {
    id: 'still-life',
    title: 'Impossible Still Life',
    blurb: 'Five meshes — pedestal, fruit, ring and berries — merged into one stained-glass still life.',
    color: '#b4552d',
    category: 'sculpture',
    nodes: 22,
    graph: () =>
      makeGraph({
        name: 'Impossible Still Life',
        nodes: [
          ['field.noise', 0, -240, { scale: 1.4, octaves: 4, seed: 21 }], // 0 lobes
          ['field.noise', 0, 100, { scale: 3.2, octaves: 2, seed: 33, range: 'positive' }], // 1 fine detail
          ['shape.cylinder', 0, 440, {
            radiusTop: 0.95, radiusBottom: 1.1, height: 0.5, radialSeg: 96, heightSeg: 8,
          }], // 2 pedestal
          ['shape.sphere', 0, 780, { radius: 0.8, segX: 96, segY: 64 }], // 3 fruit
          ['shape.torus', 0, 1120, { radius: 0.55, tube: 0.16, radialSeg: 64, tubularSeg: 200 }], // 4 ring
          ['shape.ico', 0, 1460, { radius: 0.3, detail: 2 }], // 5 berry one
          ['shape.ico', 0, 1740, { radius: 0.22, detail: 2 }], // 6 berry two
          ['math.smin', 440, -70, { k: 0.5 }], // 7 melt the two noises
          ['geo.transform', 440, 440, { posY: -1.05 }], // 8 drop the pedestal under the fruit
          ['geo.displace', 440, 780, { amount: 0.28 }], // 9
          ['geo.twist', 440, 1120, { angle: 160, axis: 'y' }], // 10
          ['geo.transform', 440, 1460, { posX: -0.55, posY: 0.95 }], // 11 rest berry one on the fruit
          ['geo.transform', 440, 1740, { posX: 0.55, posY: 0.72 }], // 12 rest berry two on the fruit
          ['geo.transform', 880, 1120, { posX: 1.15, posY: 0.1, rotX: -12, rotZ: 20 }], // 13 lean the ring on the fruit
          ['field.voronoi', 880, 1480, { scale: 3.4, mode: 'cell', range: '01', seed: 11 }], // 14
          ['geo.merge', 1320, 860, {}], // 15
          ['color.ramp', 1320, 1480, {
            stops: ramp([0, '#241a20'], [0.35, '#b4552d'], [0.62, '#7fb069'], [0.85, '#e8dcc0'], [1, '#f7f0e0']),
          }], // 16
          ['material.standard', 1760, 1280, { roughness: 0.6, metalness: 0.05 }], // 17
          ['scene.sky', 2200, 760, { mode: 'environment', environment: 'studio', envIntensity: 1 }], // 18
          ['light.preset', 2200, 1180, { preset: 'soft', intensity: 1.1 }], // 19
          ['scene.camera', 2200, 1600, { distance: 5.6, targetY: 0 }], // 20
          ['output.render', 2640, 1100, { exposure: 1, autoFrame: 1 }], // 21
        ],
        links: [
          [0, 'out', 7, 'a'],
          [1, 'out', 7, 'b'],
          [7, 'out', 9, 'amount'],
          [3, 'out', 9, 'geometry'],
          [2, 'out', 8, 'geometry'],
          [8, 'out', 15, 'parts'],
          [9, 'out', 15, 'parts'],
          [4, 'out', 10, 'geometry'],
          [10, 'out', 13, 'geometry'],
          [13, 'out', 15, 'parts'],
          [5, 'out', 11, 'geometry'],
          [11, 'out', 15, 'parts'],
          [6, 'out', 12, 'geometry'],
          [12, 'out', 15, 'parts'],
          [15, 'out', 21, 'geometry'],
          [14, 'out', 16, 'value'],
          [16, 'out', 17, 'color'],
          [17, 'out', 21, 'material'],
          [18, 'out', 21, 'sky'],
          [19, 'out', 21, 'lights'],
          [20, 'out', 21, 'camera'],
        ],
        groups: [
          { title: 'Orchard', note: 'Two noises melted into one lumpy field for the fruit.', color: '#38bdf8', nodes: [0, 1, 7] },
          { title: 'Pedestal', color: '#a78bfa', nodes: [2, 8] },
          { title: 'Fruit', color: '#a78bfa', nodes: [3, 9] },
          { title: 'Ring', note: 'Twisted, then leaned against the fruit.', color: '#a78bfa', nodes: [4, 10, 13] },
          { title: 'Berries', color: '#a78bfa', nodes: [5, 6, 11, 12] },
          { title: 'Assemble', note: 'Merge joins all five parts into one mesh.', color: '#8b5cf6', nodes: [15] },
          { title: 'Colour', note: 'One cellular glaze over everything, like stained glass.', color: '#fb7185', nodes: [14, 16, 17] },
          { title: 'Scene', color: '#2dd4bf', nodes: [18, 19, 20] },
          { title: 'Output', color: '#f43f5e', nodes: [21] },
        ],
      }),
  },

  // ================================================================ 13. ABYSS
  {
    id: 'abyss',
    title: 'Abyssal Vent',
    blurb: 'A deep-sea vent: glowing cracks, a rising particle plume, fog and a hot point light.',
    color: '#ff7a2a',
    category: 'scene',
    nodes: 20,
    graph: () =>
      makeGraph({
        name: 'Abyssal Vent',
        nodes: [
          ['shape.cylinder', 0, 0, {
            radiusTop: 0.32, radiusBottom: 0.85, height: 2.6, radialSeg: 96, heightSeg: 48,
          }], // 0 chimney
          ['shape.plane', 0, 440, { width: 7, height: 7, segX: 110, segY: 110 }], // 1 seafloor
          ['field.noise', 440, -260, {
            scale: 1.1, octaves: 5, mode: 'ridged', range: 'positive', seed: 61,
          }], // 2 jagged rock
          ['field.noise', 440, 160, {
            scale: 0.55, octaves: 5, mode: 'ridged', range: 'positive', seed: 62,
          }], // 3 dunes
          ['field.voronoi', 440, 580, { scale: 3, mode: 'edge', range: '01', seed: 63 }], // 4 cracks
          ['field.noise', 440, 1000, {
            scale: 1.2, octaves: 4, mode: 'billow', range: 'positive', seed: 64,
          }], // 5 plume wisps
          ['geo.displace', 880, 0, { amount: 0.5 }], // 6
          ['geo.displace', 880, 440, { amount: 0.55 }], // 7
          ['color.ramp', 880, 760, {
            stops: ramp([0, '#0a0d12'], [0.5, '#232b36'], [0.8, '#4a5563'], [1, '#8b98a5']),
          }], // 8 basalt
          ['color.ramp', 880, 1100, {
            stops: ramp([0, '#000000'], [0.55, '#000000'], [0.78, '#ff5a1f'], [1, '#ffd9a0']),
          }], // 9 lava in the cracks
          ['geo.transform', 1320, 440, { rotX: -90 }], // 10 lay the sheet flat
          ['material.standard', 1320, 760, {
            roughness: 0.9, metalness: 0.1, emissive: '#ff6a2a', emissiveIntensity: 2.2,
          }], // 11
          ['points.volume', 1320, 1150, {
            width: 2.2, height: 3.2, depth: 2.2, count: 40000, threshold: 0.12, seed: 65,
          }], // 12 plume
          ['geo.merge', 1760, 220, {}], // 13
          ['scene.sky', 2200, 120, { mode: 'gradient', color: '#020610', color2: '#0a2536' }], // 14
          ['scene.fog', 2200, 520, { mode: 'exponential', color: '#04121e', density: 0.045 }], // 15
          ['light.preset', 2200, 920, { preset: 'night', intensity: 0.9 }], // 16 moonlight
          ['light.point', 2200, 1320, {
            color: '#ff7a2a', intensity: 18, x: 0, y: 2.2, z: 1.5, distance: 12, decay: 2,
          }], // 17 heat
          ['scene.camera', 2200, 1720, { distance: 6.5, fov: 45, targetY: 0.6 }], // 18
          ['output.render', 2640, 800, { exposure: 1.05, autoFrame: 1 }], // 19
        ],
        links: [
          [0, 'out', 6, 'geometry'],
          [2, 'out', 6, 'amount'],
          [1, 'out', 7, 'geometry'],
          [3, 'out', 7, 'amount'],
          [7, 'out', 10, 'geometry'],
          [6, 'out', 13, 'parts'],
          [10, 'out', 13, 'parts'],
          [13, 'out', 19, 'geometry'],
          [4, 'out', 8, 'value'],
          [8, 'out', 11, 'color'],
          [4, 'out', 9, 'value'],
          [9, 'out', 11, 'emissive'],
          [11, 'out', 19, 'material'],
          [5, 'out', 12, 'density'],
          [12, 'out', 19, 'points'],
          [14, 'out', 19, 'sky'],
          [15, 'out', 19, 'fog'],
          [16, 'out', 19, 'lights'],
          [17, 'out', 19, 'lights'],
          [18, 'out', 19, 'camera'],
        ],
        groups: [
          { title: 'Vent', note: 'Ridged noise chews the chimney into jagged rock.', color: '#8b5cf6', nodes: [0, 2, 6] },
          { title: 'Seafloor', color: '#8b5cf6', nodes: [1, 3, 7, 10] },
          { title: 'Assemble', color: '#8b5cf6', nodes: [13] },
          { title: 'Rock & glow', note: 'Basalt greys for the rock; the same cracks burn orange as emissive.', color: '#fb7185', nodes: [4, 8, 9, 11] },
          { title: 'Plume', note: 'Billow noise keeps only the wispy points.', color: '#fb923c', nodes: [5, 12] },
          { title: 'Atmosphere', note: 'Two lights stack on the multi Lights socket: moonlight plus vent heat.', color: '#2dd4bf', nodes: [14, 15, 16, 17, 18] },
          { title: 'Output', color: '#f43f5e', nodes: [19] },
        ],
      }),
  },

  // ========================================================== 14. EMBER STORM
  {
    id: 'ember-storm',
    title: 'Ember Storm',
    blurb: 'A churning knot throws 14 000 sparks while time feeds the flames and keyframes breathe the exposure.',
    color: '#ffb703',
    category: 'particles',
    nodes: 16,
    graph: () =>
      makeGraph({
        name: 'Ember Storm',
        nodes: [
          ['input.time', 0, -200, { speed: 1.2 }], // 0 wind
          ['input.keyframes', 0, 140, {
            keys: [
              { t: 0, v: 0, ease: 'smooth' },
              { t: 3, v: 120, ease: 'smooth' },
              { t: 6, v: 30, ease: 'smooth' },
            ],
            loop: 'pingpong',
          }], // 1 churn driver
          ['input.keyframes', 0, 480, {
            keys: [
              { t: 0, v: 0.9, ease: 'smooth' },
              { t: 1, v: 1.25, ease: 'smooth' },
              { t: 2, v: 0.9, ease: 'smooth' },
            ],
            loop: 'loop',
          }], // 2 breathing exposure
          ['shape.knot', 0, 820, {
            radius: 1, tube: 0.32, p: 3, q: 4, seg: 300, tubeSeg: 36,
          }], // 3 the brand (never rendered — only a spark source)
          ['geo.twist', 440, 820, {}], // 4
          ['field.noise', 440, -160, {
            scale: 1.6, octaves: 3, mode: 'billow', range: 'positive', seed: 71,
          }], // 5 flames
          ['field.noise', 440, 200, { scale: 2.6, octaves: 2, range: 'positive', seed: 72 }], // 6 patches
          ['math.mix', 880, 20, { t: 0.5 }], // 7
          ['points.scatter', 880, 820, { count: 14000, jitter: 0.5, seed: 73 }], // 8
          ['color.ramp', 880, 1200, {
            stops: ramp([0, '#140806'], [0.4, '#a4161a'], [0.7, '#ff5a1f'], [0.9, '#ffb703'], [1, '#fff3b0']),
          }], // 9
          ['material.points', 1320, 1000, { size: 0.045, shape: 'circle', softness: 0.55, opacity: 0.95 }], // 10
          ['scene.sky', 1760, 300, { mode: 'environment', environment: 'night', envIntensity: 1 }], // 11
          ['scene.fog', 1760, 700, { mode: 'exponential', color: '#0d0603', density: 0.02 }], // 12
          ['light.preset', 1760, 1100, { preset: 'dramatic', intensity: 1 }], // 13
          ['scene.camera', 1760, 1500, { distance: 5.2, autoRotate: 1, speed: 0.6 }], // 14
          ['output.render', 2200, 700, { exposure: 1.05, autoFrame: 1 }], // 15
        ],
        links: [
          [0, 'out', 5, 'oz'],
          [3, 'out', 4, 'geometry'],
          [1, 'out', 4, 'angle'],
          [4, 'out', 8, 'geometry'],
          [5, 'out', 7, 'a'],
          [6, 'out', 7, 'b'],
          [7, 'out', 8, 'density'],
          [5, 'out', 9, 'value'],
          [9, 'out', 10, 'color'],
          [8, 'out', 15, 'points'],
          [10, 'out', 15, 'material'],
          [2, 'out', 15, 'exposure'],
          [11, 'out', 15, 'sky'],
          [12, 'out', 15, 'fog'],
          [13, 'out', 15, 'lights'],
          [14, 'out', 15, 'camera'],
        ],
        groups: [
          { title: 'Wind', note: 'Time flows the flames; two keyframe curves churn and breathe.', color: '#f0b429', nodes: [0, 1, 2] },
          { title: 'Brand', note: 'A twisting knot the sparks are scattered from — never rendered itself.', color: '#a78bfa', nodes: [3, 4] },
          { title: 'Embers', note: 'Flames × patches decide where all 14 000 sparks live.', color: '#fb923c', nodes: [5, 6, 7, 8] },
          { title: 'Colour', color: '#fb7185', nodes: [9, 10] },
          { title: 'Atmosphere', color: '#2dd4bf', nodes: [11, 12, 13, 14] },
          { title: 'Output', color: '#f43f5e', nodes: [15] },
        ],
      }),
  },

  // ========================================================= 15. SHADER NEON
  {
    id: 'shader-neon',
    title: 'Neon Grid',
    blurb: 'The 2D workspace in miniature: centred UVs become a pulsing cyan grid, straight into Shader Canvas.',
    color: '#22d3ee',
    category: 'shader',
    nodes: 11,
    graph: () =>
      makeGraph({
        name: 'Neon Grid',
        nodes: [
          ['shader.uv', 0, 0, { mode: 'center' }], // 0
          ['shader.swizzle', 440, -40, { mask: 'x' }], // 1
          ['shader.swizzle', 440, 300, { mask: 'y' }], // 2
          ['shader.expr', 880, -40, { code: 'pow(1.0-abs(fract(a*3.0)-0.5)*2.0, 8.0)', dim: '1' }], // 3 lines X
          ['shader.expr', 880, 300, { code: 'pow(1.0-abs(fract(a*3.0)-0.5)*2.0, 8.0)', dim: '1' }], // 4 lines Y
          ['shader.op', 1320, 130, { op: 'add' }], // 5
          ['shader.expr', 1320, 560, { code: '0.6+0.4*sin(b*2.0)', dim: '1' }], // 6 pulse
          ['shader.op', 1760, 340, { op: 'mul' }], // 7
          ['shader.vec', 1760, 760, { width: '3', x: 0.1 }], // 8 cyan: (0.1, grid, grid)
          ['output.shader', 2200, 550, {}], // 9
          ['input.time', 880, 680, { speed: 1 }], // 10
        ],
        links: [
          [0, 'out', 1, 'value'],
          [0, 'out', 2, 'value'],
          [1, 'out', 3, 'a'],
          [2, 'out', 4, 'a'],
          [3, 'out', 5, 'a'],
          [4, 'out', 5, 'b'],
          [5, 'out', 7, 'a'],
          [10, 'out', 6, 'b'],
          [6, 'out', 7, 'b'],
          [7, 'out', 8, 'y'],
          [7, 'out', 8, 'z'],
          [8, 'out', 9, 'color'],
        ],
        groups: [
          { title: 'Coordinates', note: 'Centred UVs split into an X and a Y channel.', color: '#a3e635', nodes: [0, 1, 2] },
          { title: 'Lines', note: 'Two raw GLSL snippets draw the thin grid lines.', color: '#a3e635', nodes: [3, 4, 5] },
          { title: 'Pulse', note: 'Time breathes the brightness while the canvas plays.', color: '#f0b429', nodes: [10, 6, 7] },
          { title: 'Colour', color: '#fb7185', nodes: [8] },
          { title: 'Output', color: '#f43f5e', nodes: [9] },
        ],
      }),
  },

  // ========================================================= 16. SHADER TYPE
  {
    id: 'shader-type',
    title: 'Type Storm',
    blurb: 'A text plate sampled with scrolling UVs and a hue-cycling tint — external input meets GLSL.',
    color: '#e879f9',
    category: 'shader',
    nodes: 9,
    graph: () =>
      makeGraph({
        name: 'Type Storm',
        nodes: [
          ['input.text', 0, 0, { text: 'FLUX', size: 160, color: '#ffffff' }], // 0
          ['shader.uv', 0, 480, { mode: 'uv' }], // 1
          ['input.time', 0, 920, { speed: 1 }], // 2
          ['shader.expr', 440, 240, { code: 'fract(a+vec2(b*0.05,0.0))', dim: '2' }], // 3 scroll
          ['shader.expr', 440, 720, { code: '0.5+0.5*cos(6.2831*(b*0.05)+vec3(0.0,2.1,4.2))', dim: '3' }], // 4 hue
          ['shader.sample', 880, 240, {}], // 5
          ['shader.swizzle', 880, 720, { mask: 'rgb' }], // 6
          ['shader.op', 1320, 480, { op: 'mul' }], // 7
          ['output.shader', 1760, 480, {}], // 8
        ],
        links: [
          [1, 'out', 3, 'a'],
          [2, 'out', 3, 'b'],
          [2, 'out', 4, 'b'],
          [0, 'out', 5, 'texture'],
          [3, 'out', 5, 'uv'],
          [5, 'out', 6, 'value'],
          [6, 'out', 7, 'a'],
          [4, 'out', 7, 'b'],
          [7, 'out', 8, 'color'],
        ],
        groups: [
          { title: 'Type', note: 'A text plate rendered to a texture — no file needed.', color: '#a3e635', nodes: [0] },
          { title: 'Coordinates', note: 'UVs scroll sideways with time.', color: '#a3e635', nodes: [1, 2, 3] },
          { title: 'Colour', note: 'Glyph mask × cycling hue, straight to the canvas.', color: '#fb7185', nodes: [4, 5, 6, 7] },
          { title: 'Output', color: '#f43f5e', nodes: [8] },
        ],
      }),
  },

  // ======================================================== 17. PURE PLASMA
  {
    id: 'shader-pure',
    title: 'Pure Plasma',
    blurb: 'A fire plasma with zero typed code — wired, dialed and picked, never written.',
    color: '#fb923c',
    category: 'shader',
    nodes: 17,
    graph: () =>
      makeGraph({
        name: 'Pure Plasma',
        nodes: [
          ['shader.uv', 0, 0, { mode: 'center' }], // 0
          ['shader.swizzle', 440, -40, { mask: 'x' }], // 1
          ['shader.swizzle', 440, 300, { mask: 'y' }], // 2
          ['input.time', 0, 440, { speed: 1 }], // 3
          ['shader.op', 880, -40, { op: 'mul', b: 4 }], // 4
          ['shader.op', 880, 300, { op: 'mul', b: 4 }], // 5
          ['shader.op', 1320, -40, { op: 'add' }], // 6
          ['shader.op', 1320, 300, { op: 'add' }], // 7
          ['shader.op', 1760, -40, { op: 'sin' }], // 8
          ['shader.op', 1760, 300, { op: 'cos' }], // 9
          ['shader.op', 2200, 130, { op: 'add' }], // 10 plasma in −2…2
          ['shader.op', 2640, 130, { op: 'mul', b: 0.25 }], // 11 remap to −0.5…0.5
          ['shader.op', 3080, 130, { op: 'add', b: 0.5 }], // 12 remap to 0…1
          ['color.solid', 2200, 560, { color: '#1a0533' }], // 13 ember purple
          ['color.solid', 2200, 900, { color: '#ff5a1f' }], // 14 ember orange
          ['shader.op', 3080, 560, { op: 'mix' }], // 15
          ['output.shader', 3520, 350, {}], // 16
        ],
        links: [
          [0, 'out', 1, 'value'],
          [0, 'out', 2, 'value'],
          [1, 'out', 4, 'a'],
          [2, 'out', 5, 'a'],
          [4, 'out', 6, 'a'],
          [3, 'out', 6, 'b'],
          [5, 'out', 7, 'a'],
          [3, 'out', 7, 'b'],
          [6, 'out', 8, 'a'],
          [7, 'out', 9, 'a'],
          [8, 'out', 10, 'a'],
          [9, 'out', 10, 'b'],
          [10, 'out', 11, 'a'],
          [11, 'out', 12, 'a'],
          [13, 'out', 15, 'a'],
          [14, 'out', 15, 'b'],
          [12, 'out', 15, 'c'],
          [15, 'out', 16, 'color'],
        ],
        groups: [
          { title: 'Coordinates', color: '#a3e635', nodes: [0, 1, 2] },
          { title: 'Waves', note: 'Sine meets cosine — no typing, just wires and dials.', color: '#a3e635', nodes: [3, 4, 5, 6, 7, 8, 9] },
          { title: 'Plasma', note: 'Summed, then remapped into a 0…1 mask.', color: '#a3e635', nodes: [10, 11, 12] },
          { title: 'Palette', note: 'Two picked colours blended by the plasma.', color: '#fb7185', nodes: [13, 14, 15] },
          { title: 'Output', color: '#f43f5e', nodes: [16] },
        ],
      }),
  },

  // ========================================================= 18. MASKED PHOTO
  {
    id: 'shader-photo',
    title: 'Masked Photo',
    blurb: 'Your photo here: sharp versus blurred, masked by fractal noise. Swap in any image with Choose file.',
    color: '#38bdf8',
    category: 'shader',
    nodes: 8,
    graph: () =>
      makeGraph({
        name: 'Masked Photo',
        nodes: [
          ['input.image', 0, 0, { src: TESTCARD }], // 0 a test card until you pick your own photo
          ['shader.uv', 0, 380, { mode: 'uv' }], // 1
          ['shader.sample', 440, 0, {}], // 2 sharp
          ['shader.blur', 440, 380, { radius: 3 }], // 3 soft
          ['shader.noise', 440, 760, { coords: 'center', scale: 2.5, octaves: 4, seed: 3 }], // 4 mask field
          ['shader.op', 880, 560, { op: 'smoothstep', a: 0.35, b: 0.65 }], // 5 soft mask edge
          ['shader.op', 880, 180, { op: 'mix' }], // 6
          ['output.shader', 1320, 370, {}], // 7
        ],
        links: [
          [1, 'out', 2, 'uv'],
          [0, 'out', 2, 'texture'],
          [0, 'out', 3, 'texture'],
          [1, 'out', 3, 'uv'],
          [4, 'out', 5, 'c'],
          [2, 'out', 6, 'a'],
          [3, 'out', 6, 'b'],
          [5, 'out', 6, 'c'],
          [6, 'out', 7, 'color'],
        ],
        groups: [
          { title: 'Photo', note: 'A test card until you pick your own photo — sharp and blurred copies below.', color: '#a3e635', nodes: [0] },
          { title: 'Copies', note: 'Sample reads it sharp; Blur softens it. Same UVs, same photo.', color: '#a3e635', nodes: [1, 2, 3] },
          { title: 'Mask', note: 'Fractal noise thresholded soft — the filter only lands where the mask is bright.', color: '#a3e635', nodes: [4, 5] },
          { title: 'Grade', color: '#fb7185', nodes: [6] },
          { title: 'Output', color: '#f43f5e', nodes: [7] },
        ],
      }),
  },
];

export default PRESETS;
