/**
 * Node manifest — the schema every node, preset and UI panel agrees on.
 *
 * This file contains *no* behaviour, only shape: type ids, labels, categories,
 * inputs (which double as the node's visible parameters) and outputs. The
 * implementations live in src/nodes/* and import their half from here, so the
 * catalogue and the code can never drift apart.
 *
 * Input rows render as:  [port] Label [control]   — so every knob is also a
 * wireable socket. An input with a `widget` shows an inline control; one
 * without is a socket only.
 */

import { register } from './registry.js';
import { KEY_DEFAULTS } from './curves.js';
import { SHADER_OPS } from './glsl.js';

// ---------------------------------------------------------------- categories

export const CATEGORIES = {
  input: { label: 'Inputs', color: '#f0b429', icon: '◐', desc: 'Constants and time.' },
  field: { label: 'Fields', color: '#38bdf8', icon: '∿', desc: 'Patterns that vary across space.' },
  math: { label: 'Math', color: '#facc15', icon: '±', desc: 'Combine and reshape values.' },
  color: { label: 'Colour', color: '#fb7185', icon: '◍', desc: 'Turn values into colour.' },
  shape: { label: 'Shapes', color: '#a78bfa', icon: '◇', desc: 'Start from a solid.' },
  geo: { label: 'Deform', color: '#8b5cf6', icon: '〜', desc: 'Bend, twist and merge meshes.' },
  points: { label: 'Particles', color: '#fb923c', icon: '∴', desc: 'Scatter points through space.' },
  material: { label: 'Material', color: '#34d399', icon: '◑', desc: 'How a surface reacts to light.' },
  shader: { label: 'Shader 2D', color: '#a3e635', icon: '▦', desc: 'GLSL expressions and textures for the 2D workspace.' },
  scene: { label: 'Scene', color: '#2dd4bf', icon: '☁', desc: 'Sky, fog and camera.' },
  light: { label: 'Lights', color: '#fde047', icon: '☀', desc: 'Illuminate the scene.' },
  output: { label: 'Output', color: '#f43f5e', icon: '◉', desc: 'What actually gets rendered.' },
  util: { label: 'Notes', color: '#94a3b8', icon: '✎', desc: 'Comments and helpers.' },
};

export const CATEGORY_ORDER = [
  'input',
  'field',
  'math',
  'color',
  'shape',
  'geo',
  'points',
  'material',
  'shader',
  'scene',
  'light',
  'output',
  'util',
];

// ------------------------------------------------------------- input builders

const num = (key, label, def, extra = {}) => ({ key, label, type: 'number', widget: 'float', default: def, ...extra });
const slider = (key, label, def, min, max, step = 0.01, extra = {}) => ({
  key, label, type: 'number', widget: 'slider', default: def, min, max, step, ...extra,
});
const integer = (key, label, def, min, max, extra = {}) => ({
  key, label, type: 'number', widget: 'int', default: def, min, max, step: 1, ...extra,
});
const toggle = (key, label, def, extra = {}) => ({
  key, label, type: 'number', widget: 'toggle', default: def ? 1 : 0, ...extra,
});
const select = (key, label, def, options, extra = {}) => ({
  key, label, type: 'any', widget: 'select', default: def, options, ...extra,
});
const color = (key, label, def, extra = {}) => ({ key, label, type: 'color', widget: 'color', default: def, ...extra });
const text = (key, label, def, extra = {}) => ({ key, label, type: 'any', widget: 'text', default: def, ...extra });
const gradient = (key, label, def, extra = {}) => ({ key, label, type: 'any', widget: 'gradient', default: def, ...extra });
const curve = (key, label, def, extra = {}) => ({ key, label, type: 'any', widget: 'curve', default: def, ...extra });
const file = (key, label, def, accept, fileKind, extra = {}) => ({
  key, label, type: 'any', widget: 'file', default: def, accept, fileKind, ...extra,
});
// A shader-typed socket with an inline float box: constants are typed in,
// expressions are wired in (numbers fold to GLSL literals).
const shnum = (key, label, def, extra = {}) => ({ key, label, type: 'shader', widget: 'float', default: def, ...extra });
const field = (key, label, def = 0, extra = {}) => ({ key, label, type: 'field', default: def, ...extra });
const fieldSlider = (key, label, def, min, max, step = 0.01, extra = {}) => ({
  key, label, type: 'field', widget: 'slider', default: def, min, max, step, ...extra,
});
const port = (key, label, type, extra = {}) => ({ key, label, type, ...extra });
const out = (key, label, type) => ({ key, label, type });

const RGB = ['#f5f5f5', '#000000', '#ffffff'];

const def = (d) => ({ inputs: [], outputs: [], ...d });

// ------------------------------------------------------------------ the list

export const MANIFEST = [
  // ============================================================== INPUTS
  def({
    type: 'input.number',
    label: 'Number',
    category: 'input',
    desc: 'A single constant value. Wire it into any numeric knob to take control.',
    inputs: [num('value', 'Value', 0)],
    outputs: [out('out', 'Value', 'number')],
  }),
  def({
    type: 'input.time',
    label: 'Time',
    category: 'input',
    desc: 'Seconds since playback started. Drive any knob with it to animate.',
    dynamic: true,
    inputs: [slider('speed', 'Speed', 1, 0, 4, 0.01), num('offset', 'Offset', 0)],
    outputs: [out('out', 'Seconds', 'number')],
  }),
  def({
    type: 'input.keyframes',
    label: 'Keyframes',
    category: 'input',
    desc: 'Animate anything: draw a curve of value over time, then wire it into any knob. Follows playback — plug a source into Time to drive it yourself.',
    dynamic: true,
    inputs: [
      curve('keys', 'Curve', KEY_DEFAULTS),
      select('loop', 'Loop', 'pingpong', [
        { value: 'pingpong', label: 'Ping-pong' },
        { value: 'loop', label: 'Loop' },
        { value: 'hold', label: 'Hold once' },
      ]),
      port('time', 'Time', 'number'),
    ],
    outputs: [out('out', 'Value', 'number')],
  }),
  def({
    type: 'input.seed',
    label: 'Seed',
    category: 'input',
    desc: 'A constant integer for driving several random nodes at once.',
    inputs: [integer('value', 'Seed', 7, 0, 9999)],
    outputs: [out('out', 'Seed', 'number')],
  }),

  // ============================================================== FIELDS
  def({
    type: 'field.noise',
    label: 'Noise',
    category: 'field',
    desc: 'Fractal Perlin noise — clouds, terrain, organic surface detail.',
    inputs: [
      slider('scale', 'Scale', 0.6, 0.01, 20, 0.01),
      num('ox', 'Offset X', 0),
      num('oy', 'Offset Y', 0),
      num('oz', 'Offset Z', 0),
      integer('octaves', 'Octaves', 4, 1, 8),
      slider('persistence', 'Persistence', 0.5, 0, 1, 0.01),
      slider('lacunarity', 'Lacunarity', 2, 1, 4, 0.01),
      select('mode', 'Character', 'smooth', ['smooth', 'ridged', 'billow', 'white']),
      select('range', 'Range', 'signed', [
        { value: 'signed', label: '−1 … 1' },
        { value: 'positive', label: '0 … 1' },
      ]),
      integer('seed', 'Seed', 0, 0, 9999),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),
  def({
    type: 'field.noise4',
    label: 'Noise 4D',
    category: 'field',
    desc: 'Fractal noise with a fourth spatial axis — drive W with Keyframes or Time and the pattern morphs in place instead of flowing.',
    inputs: [
      slider('scale', 'Scale', 0.6, 0.01, 20, 0.01),
      num('ox', 'Offset X', 0),
      num('oy', 'Offset Y', 0),
      num('oz', 'Offset Z', 0),
      num('w', 'W axis', 0),
      integer('octaves', 'Octaves', 4, 1, 8),
      slider('persistence', 'Persistence', 0.5, 0, 1, 0.01),
      slider('lacunarity', 'Lacunarity', 2, 1, 4, 0.01),
      select('mode', 'Character', 'smooth', ['smooth', 'ridged', 'billow', 'white']),
      select('range', 'Range', 'signed', [
        { value: 'signed', label: '−1 … 1' },
        { value: 'positive', label: '0 … 1' },
      ]),
      integer('seed', 'Seed', 0, 0, 9999),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),
  def({
    type: 'field.voronoi',
    label: 'Cells',
    category: 'field',
    desc: 'Voronoi / cellular noise — cracked mud, scales, pebbles, dragon skin.',
    inputs: [
      slider('scale', 'Scale', 2, 0.1, 30, 0.1),
      slider('jitter', 'Jitter', 1, 0, 1, 0.01),
      select('mode', 'Mode', 'edge', [
        { value: 'f1', label: 'Distance (F1)' },
        { value: 'f2', label: 'Distance (F2)' },
        { value: 'edge', label: 'Edge cracks' },
        { value: 'cell', label: 'Cell colour' },
      ]),
      select('range', 'Range', 'raw', [
        { value: 'raw', label: 'Raw' },
        { value: '01', label: '0 … 1' },
      ]),
      integer('seed', 'Seed', 0, 0, 9999),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),
  def({
    type: 'field.checker',
    label: 'Checker',
    category: 'field',
    desc: 'Alternating blocks and grids — classic test-pattern shapes.',
    inputs: [
      slider('scale', 'Scale', 3, 0.1, 50, 0.1),
      num('ox', 'Offset X', 0),
      num('oy', 'Offset Y', 0),
      num('oz', 'Offset Z', 0),
      select('mode', 'Mode', 'checker', ['checker', 'grid', 'bars']),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),
  def({
    type: 'field.gradient',
    label: 'Gradient',
    category: 'field',
    desc: 'A smooth ramp across the object — top to bottom, centre to edge, and so on.',
    inputs: [
      select('axis', 'Axis', 'y', [
        { value: 'x', label: 'Left → right' },
        { value: 'y', label: 'Bottom → top' },
        { value: 'z', label: 'Back → front' },
        { value: 'radial', label: 'Centre → out' },
        { value: 'diagonal', label: 'Diagonal' },
      ]),
      slider('start', 'Start', 0, -2, 2, 0.01),
      slider('end', 'End', 1, -2, 2, 0.01),
      toggle('clamp', 'Clamp', true),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),
  def({
    type: 'field.rings',
    label: 'Rings',
    category: 'field',
    desc: 'Soft concentric bands radiating from a point.',
    inputs: [
      slider('frequency', 'Frequency', 6, 0, 60, 0.1),
      slider('softness', 'Softness', 0.5, 0, 1, 0.01),
      num('cx', 'Centre X', 0),
      num('cy', 'Centre Y', 0),
      num('cz', 'Centre Z', 0),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),
  def({
    type: 'field.wave',
    label: 'Wave',
    category: 'field',
    desc: 'Reshape any value into a repeating waveform — stripes, pulses, teeth.',
    inputs: [
      field('input', 'Input', 0),
      select('waveform', 'Waveform', 'sine', ['sine', 'triangle', 'saw', 'square', 'pulse']),
      slider('frequency', 'Frequency', 1, 0, 50, 0.01),
      slider('phase', 'Phase', 0, 0, 1, 0.001),
      slider('duty', 'Duty', 0.5, 0.01, 0.99, 0.01),
      slider('amplitude', 'Amplitude', 1, -4, 4, 0.01),
      num('offset', 'Offset', 0),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),
  def({
    type: 'field.position',
    label: 'Coordinate',
    category: 'field',
    desc: 'The raw position on the object — x, y, z, distance from centre, or angle.',
    inputs: [
      select('axis', 'Component', 'x', [
        { value: 'x', label: 'X' },
        { value: 'y', label: 'Y' },
        { value: 'z', label: 'Z' },
        { value: 'radius', label: 'Distance from centre' },
        { value: 'angle', label: 'Angle around Y' },
      ]),
      slider('start', 'From', -1, -10, 10, 0.01),
      slider('end', 'To', 1, -10, 10, 0.01),
      toggle('clamp', 'Normalise', true),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),
  def({
    type: 'field.warp',
    label: 'Domain Warp',
    category: 'field',
    desc: 'Slide the sample point around so a pattern bends and swirls.',
    inputs: [
      field('value', 'Pattern', 0),
      fieldSlider('dx', 'Shift X', 0, -2, 2),
      fieldSlider('dy', 'Shift Y', 0, -2, 2),
      fieldSlider('dz', 'Shift Z', 0, -2, 2),
      slider('amount', 'Amount', 1, -4, 4, 0.01),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),
  def({
    type: 'field.random',
    label: 'White Noise',
    category: 'field',
    desc: 'Pure grain — every point gets an unrelated value. Great for sparkle.',
    inputs: [
      slider('scale', 'Scale', 4, 0.1, 80, 0.1),
      integer('seed', 'Seed', 0, 0, 9999),
    ],
    outputs: [out('out', 'Field', 'field')],
  }),

  // ================================================================ MATH
  def({
    type: 'math.add', label: 'Add', category: 'math', desc: 'a + b',
    inputs: [field('a', 'A', 0), field('b', 'B', 0)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.subtract', label: 'Subtract', category: 'math', desc: 'a − b',
    inputs: [field('a', 'A', 0), field('b', 'B', 0)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.multiply', label: 'Multiply', category: 'math', desc: 'a × b — the workhorse for scaling a pattern.',
    inputs: [field('a', 'A', 1), field('b', 'B', 1)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.divide', label: 'Divide', category: 'math', desc: 'a ÷ b, with a zero guard.',
    inputs: [field('a', 'A', 1), field('b', 'B', 1)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.power', label: 'Power', category: 'math', desc: 'aᵇ — raising a value sharpens its contrast.',
    inputs: [field('a', 'A', 0), field('b', 'B', 2)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.modulo', label: 'Modulo', category: 'math', desc: 'The remainder — repeats a value over and over.',
    inputs: [field('a', 'A', 0), field('divisor', 'Divisor', 1)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.abs', label: 'Absolute', category: 'math', desc: 'Removes the sign, folding negatives onto positives.',
    inputs: [field('a', 'A', 0)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.fract', label: 'Fraction', category: 'math', desc: 'Keeps only the decimal part — turns a ramp into saw teeth.',
    inputs: [field('a', 'A', 0)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.floor', label: 'Floor', category: 'math', desc: 'Rounds down to a whole number — makes hard steps.',
    inputs: [field('a', 'A', 0)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.negate', label: 'Negate', category: 'math', desc: 'Multiplies by −1.',
    inputs: [field('a', 'A', 0)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.min', label: 'Minimum', category: 'math', desc: 'The smaller of the two.',
    inputs: [field('a', 'A', 0), field('b', 'B', 0)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.max', label: 'Maximum', category: 'math', desc: 'The larger of the two.',
    inputs: [field('a', 'A', 0), field('b', 'B', 0)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.mix', label: 'Mix', category: 'math', desc: 'Blends between A and B. Works for numbers and colours.',
    inputs: [field('a', 'A', 0), field('b', 'B', 1), fieldSlider('t', 'Amount', 0.5, 0, 1)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.clamp', label: 'Clamp', category: 'math', desc: 'Forces a value to stay inside a range.',
    inputs: [field('a', 'A', 0), field('min', 'Min', 0), field('max', 'Max', 1)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.remap', label: 'Remap', category: 'math', desc: 'Rescales one range onto another. The most useful node here.',
    inputs: [
      field('value', 'Value', 0),
      field('inMin', 'From low', 0),
      field('inMax', 'From high', 1),
      field('outMin', 'To low', 0),
      field('outMax', 'To high', 1),
      toggle('clamp', 'Clamp', true),
    ],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.smoothstep', label: 'Smooth Step', category: 'math', desc: 'An S-curve between two edges — softens hard transitions.',
    inputs: [field('edge0', 'Edge 0', 0), field('edge1', 'Edge 1', 1), field('x', 'Value', 0.5)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.step', label: 'Step', category: 'math', desc: 'Outputs 1 above the edge, 0 below — a hard cut.',
    inputs: [field('edge', 'Edge', 0), field('x', 'Value', 0)],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.trig', label: 'Trigonometry', category: 'math', desc: 'sin, cos and friends — repeats a value into waves.',
    inputs: [
      field('input', 'Input', 0),
      select('op', 'Function', 'sin', ['sin', 'cos', 'tan', 'sqrt', 'log', 'exp', 'sign', 'round']),
      slider('frequency', 'Frequency', 1, 0, 20, 0.01),
      num('offset', 'Offset', 0),
    ],
    outputs: [out('out', 'Result', 'field')],
  }),
  def({
    type: 'math.smin', label: 'Smooth Union', category: 'math', desc: 'Blends two values with a soft, organic join — melts shapes together.',
    inputs: [field('a', 'A', 0), field('b', 'B', 0), slider('k', 'Softness', 0.3, 0.001, 3, 0.001)],
    outputs: [out('out', 'Result', 'field')],
  }),

  // ============================================================== COLOUR
  def({
    type: 'color.solid',
    label: 'Colour',
    category: 'color',
    desc: 'One flat colour.',
    inputs: [color('color', 'Colour', '#ff5c8a')],
    outputs: [out('out', 'Colour', 'color')],
  }),
  def({
    type: 'color.ramp',
    label: 'Colour Ramp',
    category: 'color',
    desc: 'Maps a value onto a gradient — this is how patterns become colour.',
    inputs: [
      fieldSlider('value', 'Value', 0, -1, 2),
      gradient('stops', 'Stops', [
        { t: 0, c: '#0b1d3a' },
        { t: 0.5, c: '#7b2ff7' },
        { t: 1, c: '#f107a3' },
      ]),
      slider('low', 'Input low', 0, -4, 4, 0.01),
      slider('high', 'Input high', 1, -4, 4, 0.01),
      slider('gamma', 'Gamma', 1, 0.1, 4, 0.01),
      toggle('repeat', 'Repeat', false),
    ],
    outputs: [out('out', 'Colour', 'color')],
  }),
  def({
    type: 'color.hsv',
    label: 'Adjust Colour',
    category: 'color',
    desc: 'Nudge hue, saturation and brightness of a colour.',
    inputs: [
      color('color', 'Colour', '#ff5c8a'),
      slider('hue', 'Hue', 0, -180, 180, 1, { unit: '°' }),
      slider('saturation', 'Saturation', 0, -1, 1, 0.01),
      slider('lightness', 'Lightness', 0, -1, 1, 0.01),
    ],
    outputs: [out('out', 'Colour', 'color')],
  }),
  def({
    type: 'color.blend',
    label: 'Blend Colours',
    category: 'color',
    desc: 'Combines two colours with a mix amount or a blend mode.',
    inputs: [
      color('a', 'Colour A', '#ffffff'),
      color('b', 'Colour B', '#000000'),
      fieldSlider('t', 'Amount', 0.5, 0, 1),
      select('mode', 'Mode', 'mix', [
        { value: 'mix', label: 'Mix' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen', label: 'Screen' },
        { value: 'add', label: 'Add' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'difference', label: 'Difference' },
        { value: 'softlight', label: 'Soft light' },
      ]),
    ],
    outputs: [out('out', 'Colour', 'color')],
  }),
  def({
    type: 'color.palette',
    label: 'Palette',
    category: 'color',
    desc: 'A curated gradient you can dial through with a single value.',
    inputs: [
      select('palette', 'Palette', 'sunset', [
        { value: 'sunset', label: 'Sunset' },
        { value: 'ocean', label: 'Ocean' },
        { value: 'forest', label: 'Forest' },
        { value: 'neon', label: 'Neon' },
        { value: 'candy', label: 'Candy' },
        { value: 'ember', label: 'Ember' },
        { value: 'aurora', label: 'Aurora' },
        { value: 'mono', label: 'Mono' },
      ]),
      fieldSlider('t', 'Position', 0, 0, 1),
    ],
    outputs: [out('out', 'Colour', 'color')],
  }),

  // =============================================================== SHAPES
  def({
    type: 'shape.plane', label: 'Plane', category: 'shape', desc: 'A flat subdivided sheet.',
    inputs: [
      num('width', 'Width', 2), num('height', 'Height', 2),
      integer('segX', 'Columns', 128, 1, 512), integer('segY', 'Rows', 128, 1, 512),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'shape.sphere', label: 'Sphere', category: 'shape', desc: 'A smooth ball.',
    inputs: [
      num('radius', 'Radius', 1),
      integer('segX', 'Segments', 96, 4, 256), integer('segY', 'Rings', 64, 3, 128),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'shape.box', label: 'Box', category: 'shape', desc: 'A cube you can subdivide.',
    inputs: [
      num('width', 'Width', 1.4), num('height', 'Height', 1.4), num('depth', 'Depth', 1.4),
      integer('seg', 'Segments', 16, 1, 96),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'shape.torus', label: 'Torus', category: 'shape', desc: 'A doughnut.',
    inputs: [
      num('radius', 'Radius', 1), num('tube', 'Thickness', 0.4),
      integer('radialSeg', 'Sides', 64, 8, 160), integer('tubularSeg', 'Around', 200, 8, 512),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'shape.knot', label: 'Torus Knot', category: 'shape', desc: 'A looping woven tube.',
    inputs: [
      num('radius', 'Radius', 1), num('tube', 'Thickness', 0.35),
      integer('p', 'Loops', 2, 2, 12), integer('q', 'Twist', 3, 2, 16),
      integer('seg', 'Segments', 300, 32, 600), integer('tubeSeg', 'Sides', 48, 6, 128),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'shape.ico', label: 'Icosphere', category: 'shape', desc: 'A perfectly even sphere — the best base for faceted art.',
    inputs: [num('radius', 'Radius', 1), integer('detail', 'Detail', 3, 0, 5)],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'shape.cylinder', label: 'Cylinder', category: 'shape', desc: 'A tube with flat ends.',
    inputs: [
      num('radiusTop', 'Top radius', 0.6), num('radiusBottom', 'Bottom radius', 0.6),
      num('height', 'Height', 1.6),
      integer('radialSeg', 'Sides', 96, 6, 256), integer('heightSeg', 'Rows', 48, 1, 160),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'shape.cone', label: 'Cone', category: 'shape', desc: 'A tapering spike.',
    inputs: [
      num('radius', 'Radius', 0.8), num('height', 'Height', 1.8),
      integer('radialSeg', 'Sides', 96, 6, 256), integer('heightSeg', 'Rows', 48, 1, 160),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'shape.capsule', label: 'Capsule', category: 'shape', desc: 'A pill — great base for blobby creatures.',
    inputs: [
      num('radius', 'Radius', 0.55), num('length', 'Length', 1.2),
      integer('capSeg', 'Cap detail', 20, 2, 40), integer('radialSeg', 'Sides', 72, 6, 160),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'shape.circle', label: 'Disc', category: 'shape', desc: 'A flat filled circle.',
    inputs: [num('radius', 'Radius', 1.2), integer('segments', 'Segments', 192, 3, 512)],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),

  // =============================================================== DEFORM
  def({
    type: 'geo.displace',
    label: 'Displace',
    category: 'geo',
    desc: 'Push every vertex along a direction by the amount a field describes.',
    bypassInput: 'geometry',
    inputs: [
      port('geometry', 'Geometry', 'geometry'),
      fieldSlider('amount', 'Amount', 0.2, -2, 2),
      select('axis', 'Direction', 'normal', [
        { value: 'normal', label: 'Along normals' },
        { value: 'radial', label: 'Out from centre' },
        { value: 'x', label: '+X' },
        { value: 'y', label: '+Y' },
        { value: 'z', label: '+Z' },
      ]),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'geo.twist',
    label: 'Twist',
    category: 'geo',
    desc: 'Rotate the shape progressively along an axis.',
    bypassInput: 'geometry',
    inputs: [
      port('geometry', 'Geometry', 'geometry'),
      slider('angle', 'Angle', 90, -720, 720, 1, { unit: '°' }),
      select('axis', 'Axis', 'y', ['x', 'y', 'z']),
      slider('center', 'Centre', 0.5, -1, 2, 0.01),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'geo.bend',
    label: 'Bend',
    category: 'geo',
    desc: 'Curl the shape around an axis, like bending a ruler.',
    bypassInput: 'geometry',
    inputs: [
      port('geometry', 'Geometry', 'geometry'),
      slider('angle', 'Angle', 60, -360, 360, 1, { unit: '°' }),
      select('axis', 'Axis', 'y', ['x', 'y', 'z']),
      slider('center', 'Centre', 0.5, -1, 2, 0.01),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'geo.transform',
    label: 'Transform',
    category: 'geo',
    desc: 'Move, rotate and scale a mesh.',
    bypassInput: 'geometry',
    inputs: [
      port('geometry', 'Geometry', 'geometry'),
      num('posX', 'Move X', 0), num('posY', 'Move Y', 0), num('posZ', 'Move Z', 0),
      slider('rotX', 'Rotate X', 0, -180, 180, 1, { unit: '°' }),
      slider('rotY', 'Rotate Y', 0, -180, 180, 1, { unit: '°' }),
      slider('rotZ', 'Rotate Z', 0, -180, 180, 1, { unit: '°' }),
      slider('scaleX', 'Scale X', 1, 0, 4, 0.01),
      slider('scaleY', 'Scale Y', 1, 0, 4, 0.01),
      slider('scaleZ', 'Scale Z', 1, 0, 4, 0.01),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'geo.merge',
    label: 'Merge',
    category: 'geo',
    desc: 'Join several meshes into one. Drag more wires onto the socket to add.',
    inputs: [port('parts', 'Parts', 'geometry', { multi: true })],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),
  def({
    type: 'geo.refine',
    label: 'Refine',
    category: 'geo',
    desc: 'Adds vertices so painted detail stays smooth instead of faceted.',
    bypassInput: 'geometry',
    inputs: [
      port('geometry', 'Geometry', 'geometry'),
      integer('levels', 'Levels', 0, 0, 3),
      toggle('smooth', 'Soften', false),
    ],
    outputs: [out('out', 'Geometry', 'geometry')],
  }),

  // ============================================================ PARTICLES
  def({
    type: 'points.scatter',
    label: 'Scatter on Surface',
    category: 'points',
    desc: 'Sprinkle points across a mesh, keeping only those a density field allows.',
    inputs: [
      port('geometry', 'Geometry', 'geometry'),
      integer('count', 'Count', 5000, 1, 200000),
      fieldSlider('density', 'Density', 1, 0, 1),
      slider('jitter', 'Jitter', 0, 0, 1, 0.01),
      integer('seed', 'Seed', 0, 0, 9999),
    ],
    outputs: [out('out', 'Points', 'points')],
  }),
  def({
    type: 'points.volume',
    label: 'Fill Volume',
    category: 'points',
    desc: 'Fill a box with points, keeping only the ones a density field allows.',
    inputs: [
      num('width', 'Width', 2), num('height', 'Height', 2), num('depth', 'Depth', 2),
      integer('count', 'Attempts', 12000, 1, 300000),
      fieldSlider('density', 'Density', 1, 0, 1),
      slider('threshold', 'Threshold', 0.1, 0, 1, 0.01),
      integer('seed', 'Seed', 0, 0, 9999),
    ],
    outputs: [out('out', 'Points', 'points')],
  }),
  def({
    type: 'points.grid',
    label: 'Point Grid',
    category: 'points',
    desc: 'A regular lattice of points — tidy, ordered particle fields.',
    inputs: [
      num('width', 'Width', 2), num('height', 'Height', 2), num('depth', 'Depth', 2),
      integer('nx', 'Columns', 24, 1, 160),
      integer('ny', 'Rows', 24, 1, 160),
      integer('nz', 'Layers', 24, 1, 160),
      fieldSlider('density', 'Density', 1, 0, 1),
      slider('jitter', 'Jitter', 0, 0, 1, 0.01),
      integer('seed', 'Seed', 0, 0, 9999),
    ],
    outputs: [out('out', 'Points', 'points')],
  }),

  // ============================================================= MATERIAL
  def({
    type: 'material.standard',
    label: 'Standard Material',
    category: 'material',
    desc: 'The everyday lit surface. Drive Colour with a ramp to paint patterns.',
    inputs: [
      color('color', 'Colour', '#e8e8f0'),
      slider('roughness', 'Roughness', 0.45, 0, 1, 0.01),
      slider('metalness', 'Metalness', 0.05, 0, 1, 0.01),
      color('emissive', 'Glow colour', '#000000'),
      slider('emissiveIntensity', 'Glow strength', 1, 0, 8, 0.01),
      toggle('flatShading', 'Flat shading', false),
      select('side', 'Sides', 'front', ['front', 'back', 'double']),
      toggle('wireframe', 'Wireframe', false),
      slider('opacity', 'Opacity', 1, 0, 1, 0.01),
      toggle('transparent', 'Transparent', false),
    ],
    outputs: [out('out', 'Material', 'material')],
  }),
  def({
    type: 'material.physical',
    label: 'Physical Material',
    category: 'material',
    desc: 'Adds clear coat, glass transmission and thin-film shimmer.',
    inputs: [
      color('color', 'Colour', '#e8e8f0'),
      slider('roughness', 'Roughness', 0.2, 0, 1, 0.01),
      slider('metalness', 'Metalness', 0.1, 0, 1, 0.01),
      slider('clearcoat', 'Clear coat', 0, 0, 1, 0.01),
      slider('clearcoatRoughness', 'Coat roughness', 0.1, 0, 1, 0.01),
      slider('transmission', 'Transmission', 0, 0, 1, 0.01),
      slider('ior', 'Refractive index', 1.5, 1, 2.33, 0.01),
      slider('iridescence', 'Iridescence', 0, 0, 1, 0.01),
      color('emissive', 'Glow colour', '#000000'),
      slider('emissiveIntensity', 'Glow strength', 1, 0, 8, 0.01),
      select('side', 'Sides', 'front', ['front', 'back', 'double']),
      slider('opacity', 'Opacity', 1, 0, 1, 0.01),
    ],
    outputs: [out('out', 'Material', 'material')],
  }),
  def({
    type: 'material.toon',
    label: 'Toon Material',
    category: 'material',
    desc: 'Banded cartoon lighting with a hard outline-friendly look.',
    inputs: [
      color('color', 'Colour', '#ffd166'),
      integer('steps', 'Bands', 5, 2, 16),
      color('emissive', 'Glow colour', '#000000'),
      slider('emissiveIntensity', 'Glow strength', 1, 0, 8, 0.01),
      select('side', 'Sides', 'front', ['front', 'back', 'double']),
      slider('opacity', 'Opacity', 1, 0, 1, 0.01),
    ],
    outputs: [out('out', 'Material', 'material')],
  }),
  def({
    type: 'material.basic',
    label: 'Unlit Material',
    category: 'material',
    desc: 'Ignores all lighting — pure colour, exactly as you set it.',
    inputs: [
      color('color', 'Colour', '#7dd3fc'),
      toggle('wireframe', 'Wireframe', false),
      select('side', 'Sides', 'front', ['front', 'back', 'double']),
      slider('opacity', 'Opacity', 1, 0, 1, 0.01),
    ],
    outputs: [out('out', 'Material', 'material')],
  }),
  def({
    type: 'material.normal',
    label: 'Normal Debug',
    category: 'material',
    desc: 'Shows surface direction as colour — useful for checking a mesh.',
    inputs: [toggle('flatShading', 'Flat shading', false), select('side', 'Sides', 'front', ['front', 'back', 'double'])],
    outputs: [out('out', 'Material', 'material')],
  }),
  def({
    type: 'material.points',
    label: 'Points Material',
    category: 'material',
    desc: 'Sizes, shapes and colours the particle cloud.',
    inputs: [
      slider('size', 'Size', 0.035, 0.001, 2, 0.001),
      fieldSlider('sizeBy', 'Size multiplier', 1, 0, 4),
      color('color', 'Colour', '#7dd3fc'),
      select('shape', 'Shape', 'circle', ['circle', 'square', 'diamond', 'cross']),
      slider('softness', 'Softness', 0.35, 0, 1, 0.01),
      slider('opacity', 'Opacity', 1, 0, 1, 0.01),
      toggle('attenuation', 'Depth scale', true),
      toggle('depthWrite', 'Write depth', true),
    ],
    outputs: [out('out', 'Material', 'material')],
  }),

  // ============================================================ SHADER 2D
  // The 2D workspace: expressions assemble a fragment shader, textures feed
  // it images, and Shader Canvas renders the result fullscreen. Anything
  // wired into a shader socket folds to GLSL — numbers become literals,
  // colours become vec3, CPU fields are sampled once at the origin.
  def({
    type: 'input.image',
    label: 'Image',
    category: 'shader',
    desc: 'Load an image file as a texture. Downscaled to 1024px on import so documents stay light. Sample it with Sample Texture.',
    inputs: [file('src', 'File', '', 'image/*', 'image')],
    outputs: [out('out', 'Texture', 'texture')],
  }),
  def({
    type: 'input.text',
    label: 'Text Plate',
    category: 'shader',
    desc: 'Renders a line of text into a texture — masks, titles and type storms.',
    inputs: [
      text('text', 'Text', 'FLUX'),
      integer('size', 'Size', 128, 8, 512),
      color('color', 'Colour', '#ffffff'),
    ],
    outputs: [out('out', 'Texture', 'texture')],
  }),
  def({
    type: 'input.video',
    label: 'Video',
    category: 'shader',
    desc: 'Load a video file as a living texture. Plays muted on loop; big files are stored in the document, so keep loops short.',
    inputs: [file('src', 'File', '', 'video/*', 'video'), toggle('loop', 'Loop', true), toggle('muted', 'Mute', true)],
    outputs: [out('out', 'Texture', 'texture')],
  }),
  def({
    type: 'input.data',
    label: 'Data Table',
    category: 'shader',
    desc: 'Load a JSON or CSV file of numbers as a data texture — values land in the R channel, row by row.',
    inputs: [file('src', 'File', '', '.json,.csv,.txt,.tsv', 'data')],
    outputs: [out('out', 'Texture', 'texture')],
  }),
  def({
    type: 'shader.uv',
    label: 'UV',
    category: 'shader',
    desc: 'Pixel coordinates for the shader: 0 to 1, centred like ShaderToy, or raw pixels.',
    inputs: [
      select('mode', 'Coordinates', 'center', [
        { value: 'uv', label: '0 to 1' },
        { value: 'center', label: 'Centred' },
        { value: 'pixel', label: 'Pixels' },
      ]),
    ],
    outputs: [out('out', 'UV', 'shader')],
  }),
  def({
    type: 'shader.noise',
    label: 'Noise 2D',
    category: 'shader',
    desc: 'Fractal value noise on the GPU — the mask maker. Outputs 0…1, ready to threshold with Smoothstep.',
    inputs: [
      select('coords', 'Coordinates', 'center', [
        { value: 'center', label: 'Centred' },
        { value: 'uv', label: '0 to 1' },
        { value: 'pixel', label: 'Pixels' },
        { value: 'socket', label: 'Socket' },
      ]),
      port('pos', 'Position', 'shader'),
      slider('scale', 'Scale', 3, 0.1, 20, 0.1),
      integer('octaves', 'Octaves', 4, 1, 8),
      integer('seed', 'Seed', 0, 0, 9999),
      select('mode', 'Character', 'smooth', ['smooth', 'billow', 'ridged']),
    ],
    outputs: [out('out', 'Mask', 'shader')],
  }),
  def({
    type: 'shader.vec',
    label: 'Make Vector',
    category: 'shader',
    desc: 'Assemble a vec2 / vec3 / vec4 from components. Type constants in or wire expressions in.',
    inputs: [
      select('width', 'Size', '3', [
        { value: '2', label: 'vec2' },
        { value: '3', label: 'vec3' },
        { value: '4', label: 'vec4' },
      ]),
      shnum('x', 'X', 0),
      shnum('y', 'Y', 0),
      shnum('z', 'Z', 0),
      shnum('w', 'W', 0),
    ],
    outputs: [out('out', 'Vector', 'shader')],
  }),
  def({
    type: 'shader.op',
    label: 'Shader Op',
    category: 'shader',
    desc: 'One GLSL operation on up to three expressions — scalars broadcast, mismatched vectors trim to fit.',
    inputs: [
      select('op', 'Operation', 'add', SHADER_OPS.map((o) => ({ value: o.id, label: o.label }))),
      shnum('a', 'A', 0),
      shnum('b', 'B', 0),
      shnum('c', 'C / mix', 0.5),
    ],
    outputs: [out('out', 'Result', 'shader')],
  }),
  def({
    type: 'shader.swizzle',
    label: 'Swizzle',
    category: 'shader',
    desc: 'Pick channels out of a vector — "rgb", "ra", "x" and so on.',
    inputs: [port('value', 'Value', 'shader'), text('mask', 'Mask', 'rgb')],
    outputs: [out('out', 'Channels', 'shader')],
  }),
  def({
    type: 'shader.sample',
    label: 'Sample Texture',
    category: 'shader',
    desc: 'Read a texture at a UV coordinate. Returns RGBA.',
    inputs: [port('texture', 'Texture', 'texture'), port('uv', 'UV', 'shader')],
    outputs: [out('out', 'RGBA', 'shader')],
  }),
  def({
    type: 'shader.blur',
    label: 'Blur',
    category: 'shader',
    desc: 'A 3×3 softening filter over any texture — radius in pixels, wireable so focus can breathe.',
    inputs: [port('texture', 'Texture', 'texture'), port('uv', 'UV', 'shader'), shnum('radius', 'Radius', 2)],
    outputs: [out('out', 'RGBA', 'shader')],
  }),
  def({
    type: 'shader.expr',
    label: 'GLSL Snippet',
    category: 'shader',
    desc: 'Raw GLSL with a, b and c standing for the three inputs — the escape hatch for anything the other nodes cannot say.',
    inputs: [
      text('code', 'Code', 'sin(a*10.0)*0.5+0.5'),
      select('dim', 'Returns', '3', [
        { value: '1', label: 'Float' },
        { value: '2', label: 'vec2' },
        { value: '3', label: 'vec3' },
        { value: '4', label: 'vec4' },
      ]),
      port('a', 'A', 'shader'),
      port('b', 'B', 'shader'),
      port('c', 'C', 'shader'),
    ],
    outputs: [out('out', 'Result', 'shader')],
  }),
  def({
    type: 'output.shader',
    label: 'Shader Canvas',
    category: 'shader',
    desc: 'The 2D workspace sink — turns a colour expression into a fullscreen shader. Time, resolution, mouse and frame arrive as u_time, u_resolution, u_mouse and u_frame.',
    isOutput: true,
    inputs: [port('color', 'Colour', 'shader')],
    outputs: [],
  }),

  // =============================================================== SCENE
  def({
    type: 'scene.sky',
    label: 'Sky',
    category: 'scene',
    desc: 'The backdrop and the reflections on your surface.',
    inputs: [
      select('mode', 'Mode', 'environment', [
        { value: 'environment', label: 'Environment' },
        { value: 'gradient', label: 'Gradient' },
        { value: 'solid', label: 'Solid' },
        { value: 'transparent', label: 'Transparent' },
      ]),
      select('environment', 'Environment', 'studio', [
        { value: 'studio', label: 'Studio' },
        { value: 'sunset', label: 'Sunset' },
        { value: 'night', label: 'Night' },
        { value: 'dunes', label: 'Dunes' },
        { value: 'forest', label: 'Forest' },
        { value: 'none', label: 'None' },
      ]),
      color('color', 'Colour A', '#0b1020'),
      color('color2', 'Colour B', '#24365e'),
      slider('angle', 'Angle', 0, -180, 180, 1, { unit: '°' }),
      slider('envIntensity', 'Environment light', 1, 0, 3, 0.01),
      slider('blur', 'Background blur', 0, 0, 1, 0.01),
    ],
    outputs: [out('out', 'Sky', 'scene')],
  }),
  def({
    type: 'scene.fog',
    label: 'Fog',
    category: 'scene',
    desc: 'Fade the distance into a colour for depth and atmosphere.',
    inputs: [
      select('mode', 'Mode', 'off', ['off', 'linear', 'exponential']),
      color('color', 'Colour', '#c9d6e8'),
      slider('near', 'Near', 6, 0, 100, 0.1),
      slider('far', 'Far', 40, 0, 300, 0.1),
      slider('density', 'Density', 0.03, 0, 0.3, 0.001),
    ],
    outputs: [out('out', 'Fog', 'scene')],
  }),
  def({
    type: 'scene.camera',
    label: 'Camera',
    category: 'scene',
    desc: 'Starting view, field of view and an optional slow orbit.',
    inputs: [
      slider('distance', 'Distance', 6, 0.5, 100, 0.1),
      slider('fov', 'Field of view', 45, 15, 120, 1, { unit: '°' }),
      slider('targetY', 'Look at height', 0, -20, 20, 0.1),
      toggle('autoRotate', 'Orbit', false),
      slider('speed', 'Orbit speed', 1, 0, 10, 0.1),
    ],
    outputs: [out('out', 'Camera', 'scene')],
  }),

  // ============================================================== LIGHTS
  def({
    type: 'light.preset',
    label: 'Lighting Preset',
    category: 'light',
    desc: 'A whole lighting rig in one node.',
    inputs: [
      select('preset', 'Preset', 'studio', [
        { value: 'studio', label: 'Studio' },
        { value: 'dramatic', label: 'Dramatic' },
        { value: 'soft', label: 'Soft & flat' },
        { value: 'sunset', label: 'Sunset' },
        { value: 'night', label: 'Moonlight' },
        { value: 'neon', label: 'Neon' },
        { value: 'clay', label: 'Clay (no colour)' },
        { value: 'none', label: 'None' },
      ]),
      slider('intensity', 'Intensity', 1, 0, 3, 0.01),
    ],
    outputs: [out('out', 'Lights', 'scene')],
  }),
  def({
    type: 'light.ambient', label: 'Ambient Light', category: 'light',
    desc: 'Fills every shadow with a flat colour.',
    inputs: [color('color', 'Colour', '#ffffff'), slider('intensity', 'Intensity', 0.5, 0, 5, 0.01)],
    outputs: [out('out', 'Light', 'scene')],
  }),
  def({
    type: 'light.directional', label: 'Directional Light', category: 'light',
    desc: 'A distant sun — parallel rays with sharp shadows.',
    inputs: [
      color('color', 'Colour', '#ffffff'),
      slider('intensity', 'Intensity', 2, 0, 6, 0.01),
      slider('x', 'Direction X', 4, -10, 10, 0.1),
      slider('y', 'Direction Y', 6, -10, 10, 0.1),
      slider('z', 'Direction Z', 4, -10, 10, 0.1),
      toggle('castShadow', 'Cast shadows', true),
    ],
    outputs: [out('out', 'Light', 'scene')],
  }),
  def({
    type: 'light.point', label: 'Point Light', category: 'light',
    desc: 'A bare bulb glowing in one spot.',
    inputs: [
      color('color', 'Colour', '#ffd9a0'),
      slider('intensity', 'Intensity', 14, 0, 60, 0.5),
      slider('x', 'Position X', 0, -10, 10, 0.1),
      slider('y', 'Position Y', 2.5, -10, 10, 0.1),
      slider('z', 'Position Z', 3, -10, 10, 0.1),
      slider('distance', 'Range', 0, 0, 60, 0.1),
      slider('decay', 'Falloff', 2, 0, 4, 0.05),
      toggle('castShadow', 'Cast shadows', false),
    ],
    outputs: [out('out', 'Light', 'scene')],
  }),
  def({
    type: 'light.hemi', label: 'Sky Light', category: 'light',
    desc: 'Tints up-facing surfaces with the sky colour and down-facing with the ground.',
    inputs: [
      color('sky', 'Sky colour', '#9ecfff'),
      color('ground', 'Ground colour', '#5a4632'),
      slider('intensity', 'Intensity', 0.8, 0, 5, 0.01),
    ],
    outputs: [out('out', 'Light', 'scene')],
  }),

  // =============================================================== OUTPUT
  def({
    type: 'output.render',
    label: 'Render',
    category: 'output',
    desc: 'Everything flows here. This node is what you see in the preview.',
    isOutput: true,
    inputs: [
      port('geometry', 'Geometry', 'geometry'),
      port('points', 'Points', 'points'),
      port('material', 'Material', 'material'),
      port('sky', 'Sky', 'scene'),
      port('fog', 'Fog', 'scene'),
      port('camera', 'Camera', 'scene'),
      port('lights', 'Lights', 'scene', { multi: true }),
      toggle('shadows', 'Shadows', true),
      slider('exposure', 'Exposure', 1, 0, 3, 0.01),
      toggle('autoFrame', 'Auto-frame', true),
    ],
    outputs: [],
  }),

  // ================================================================ NOTES
  def({
    type: 'util.note',
    label: 'Note',
    category: 'util',
    desc: 'A sticky note — leave yourself a reminder on the canvas.',
    inputs: [text('text', 'Text', 'Write a note…'), color('color', 'Colour', '#fde047')],
    outputs: [],
  }),
];

// --------------------------------------------------------------- registration

/** Register every node in the manifest. Called once at startup. */
export function installManifest() {
  for (const d of MANIFEST) register(d);
}

/** Fast lookup by type id. */
export const MANIFEST_BY_TYPE = new Map(MANIFEST.map((d) => [d.type, d]));

export function manifestDef(type) {
  return MANIFEST_BY_TYPE.get(type) || null;
}

/** Palette-shaped view of the catalogue, ordered for display. */
export function catalogue() {
  const groups = [];
  for (const key of CATEGORY_ORDER) {
    const items = MANIFEST.filter((d) => d.category === key);
    if (items.length) groups.push({ key, meta: CATEGORIES[key], items });
  }
  return groups;
}
