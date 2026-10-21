# Flux Forge

**A node-based procedural art editor — wire shapes, fields and colours together on a canvas and watch a three.js artwork build itself in real time.**

Flux Forge is a browser app for *procedural* art. You don't sculpt or paint by hand: you compose a small graph. A **shape** node makes a mesh, a **field** node describes a pattern that varies across space, a **deform** node pushes the mesh around by that pattern, a **colour** node turns the pattern into paint, and a **render** node shows the result. Everything is live — tweak any knob and the preview updates on the next frame. Graphs are plain JSON, so artworks are easy to save, share and re-import. There is a gallery of eighteen ready-made presets (`P`), including the "Ripple Sphere" that loads on your first run.

Built with vanilla ES modules and [three.js](https://threejs.org/) — no framework, no build-time magic. `Vite` for dev and bundling.

---

## Run it

```bash
npm install      # once — installs three + vite
npm run dev      # dev server with hot reload
npm run build    # production bundle in dist/
npm run preview  # serve the production build locally
```

Requires a recent Node (Vite 7 wants ≥ 20.19; Node 22 LTS is a safe pick).

---

## The 60-second tutorial

The shortest path from an empty canvas to a finished artwork — the same shape every preset is built from:

1. **Add a shape.** Press <kbd>Tab</kbd> (or <kbd>Ctrl</kbd>+<kbd>K</kbd>) to open the node search and add a **Sphere** (`shape.sphere`). This is your starting mesh.
2. **Add a pattern.** Add a **Noise** node (`field.noise`). Noise outputs a *field* — a value that varies across space.
3. **Sculpt.** Add a **Displace** node (`geo.displace`). Drag a wire from the sphere's `Geometry` into Displace's **Geometry** input, and from Noise's `Field` output into Displace's **Amount** input. Set *Amount* to about `0.4` on the node. The sphere now has noise-driven bumps. (Every knob is also a socket — that's why Amount can take a wire.)
4. **Colour it.** Add a **Colour Ramp** (`color.ramp`) and wire Noise → *Value*. Pick two or three gradient stops. Add a **Standard Material** and wire Ramp → *Colour*. The field is baked into the mesh's vertex colours.
5. **Render.** Add a **Render** node (`output.render`). Wire Displace → *Geometry* and Material → *Material*. The preview now shows your artwork.
6. **Light it.** Add a **Lighting Preset** (`light.preset`, set to *Studio*) → drag its output to Render's **Lights** input, and a **Sky** node (`scene.sky`) → *Sky*. Press <kbd>F</kbd> to frame everything on the canvas.

Done — you have a lit, painted, displaced sphere. Press <kbd>P</kbd> to see eighteen finished examples of where this goes.

---

## Presets

Press <kbd>P</kbd> (or the gallery button) to load any of these. Each is a complete, grouped, fully wired graph — open one and read its groups left to right to see how it's made.

| Preset | Mode | What it shows |
| --- | --- | --- |
| **Ripple Sphere** (`starter`) | Sculpt | Noise-displaced sphere with a vivid gradient, studio light, auto-framed. Loads on first run. |
| **Ridgeline** (`terrain`) | Sculpt + colour | Ridged noise lifts a plane into mountains; a height gradient paints grass → rock → snow. |
| **Melted Blob** (`blob`) | Sculpt | A capsule melted by domain-warped noise through Smooth Union. |
| **Gem Facets** (`facets`) | Sculpt + colour | Flat-shaded icosphere; each Voronoi cell gets its own colour with dark crack lines. |
| **Aurora Knot** (`knot`) | Colour pattern | Torus knot with height stripes swirled by a domain warp, under neon light. |
| **Neon Nebula** (`neon-volume`) | Particles | A density field carves a glowing cloud out of a box of 90 000 points. |
| **Stardust Torus** (`stardust-torus`) | Particles | Points scattered on an invisible torus, sized and coloured by noise. |
| **Riso Poster** (`poster`) | Colour pattern | Flat unlit artwork: saw-wave stripes checkered against cream. No lights needed. |
| **Twisted Monolith** (`twistbox`) | Sculpt | A tall box twisted and bent into metal, banded by a ring field, dramatic light. |
| **Glass Vessel** (`glass`) | Material | Rippled physical material with transmission and iridescence against a gradient sky. |
| **Chrono Bloom** (`morph`) | Animation | Three keyframe curves morph 4-D noise, twist the mesh and pulse its glow — press play. |
| **Impossible Still Life** (`still-life`) | Multi-shape | Pedestal, fruit, ring and berries merged into one stained-glass still life. |
| **Abyssal Vent** (`abyss`) | Sculpt + particles | Glowing deep-sea vent with a particle plume, exponential fog and a hot point light. |
| **Ember Storm** (`ember-storm`) | Animation + particles | A churning knot throws 14 000 sparks while time feeds the flames. |
| **Neon Grid** (`shader-neon`) | 2D shader | The 2D workspace in miniature: centred UVs become a pulsing cyan grid. |
| **Type Storm** (`shader-type`) | 2D shader + texture | A text plate sampled with scrolling UVs and a hue-cycling tint. |
| **Pure Plasma** (`shader-pure`) | 2D shader, no code | A fire plasma with zero typed code — wired, dialed and picked, never written. |
| **Masked Photo** (`shader-photo`) | 2D photo filter | Sharp versus blurred, masked by fractal noise — swap in any image with Choose file. |

---

## 2D shader workspace

The same editor speaks GLSL. Nodes in the **Shader 2D** category assemble a fragment shader piece by piece — **UV** gives you coordinates, **Shader Op** applies one of 25 GLSL operations, **Make Vector** / **Swizzle** reshape vectors, **GLSL Snippet** runs raw code with `a`, `b` and `c` standing for its three inputs — and **Shader Canvas** renders the result fullscreen in the preview. Anything wired into a shader socket folds to GLSL: numbers become literals, colours become `vec3`, CPU fields sample once at the origin.

Every shader gets four uniforms for free: `u_time` (seconds), `u_resolution` (pixels), `u_mouse` (cursor x/y plus click x/y, pixels from the bottom-left) and `u_frame` (frames since the graph changed). Wire **Time** or **Keyframes** into any knob and the shader re-evaluates every frame while playing.

**External inputs.** Four nodes load files as textures: **Image** (downscaled to 1024px on import so documents stay light), **Text Plate** (renders text to a texture — no file needed), **Video** (a muted, looping texture; keep loops short, big files make heavy documents) and **Data Table** (JSON/CSV numbers land in the R channel row by row). Sample them with **Sample Texture**, soften them with **Blur** (radius in pixels, wireable), and mask anything with **Noise 2D** — fractal value noise on the GPU outputting 0…1, ready to threshold with Smoothstep. An empty file socket is a hard error with a badge, like Render with no geometry.

**Photo filter recipe.** Image → Sample (sharp) and Image → Blur (soft); Noise 2D → Smoothstep (soft mask edge); Mix sharp/soft by the mask → Shader Canvas. The `shader-photo` preset is exactly this graph on a test card — open it and swap in your own photo with Choose file.

Notes: colours are authored in sRGB and shown exactly as written (no tone mapping on the shader quad). Vector widths are tracked — scalars broadcast, mismatched vectors trim to fit — so composed graphs compile; the snippet node trusts you to keep its declared return width honest, and `a`/`b`/`c` are reserved words inside it. PNG export captures the shader at any scale; glTF export has no meshes to take and tells you so.

---

## Node reference

The catalogue below is the node manifest (`src/core/manifest.js`) in full — 86 nodes in 13 categories. Every node's parameters double as wireable sockets, so anything you can dial you can also drive with a pattern.

### Inputs — Constants and time.

| Type | Node | What it does |
| --- | --- | --- |
| `input.number` | Number | A single constant value. Wire it into any numeric knob to take control. |
| `input.time` | Time | Seconds since playback started. Drive any knob with it to animate. |
| `input.keyframes` | Keyframes | A curve of value over time — draw keys in the plot, wire the output into any knob. Follows playback, or plug a source into *Time* to drive it yourself. |
| `input.seed` | Seed | A constant integer for driving several random nodes at once. |

### Fields — Patterns that vary across space.

| Type | Node | What it does |
| --- | --- | --- |
| `field.noise` | Noise | Fractal Perlin noise — clouds, terrain, organic surface detail. |
| `field.noise4` | Noise 4D | Fractal noise with a fourth spatial axis — drive *W* with Keyframes or Time and the pattern morphs in place instead of flowing. |
| `field.voronoi` | Cells | Voronoi / cellular noise — cracked mud, scales, pebbles, dragon skin. |
| `field.checker` | Checker | Alternating blocks and grids — classic test-pattern shapes. |
| `field.gradient` | Gradient | A smooth ramp across the object — top to bottom, centre to edge, and so on. |
| `field.rings` | Rings | Soft concentric bands radiating from a point. |
| `field.wave` | Wave | Reshape any value into a repeating waveform — stripes, pulses, teeth. |
| `field.position` | Coordinate | The raw position on the object — x, y, z, distance from centre, or angle. |
| `field.warp` | Domain Warp | Slide the sample point around so a pattern bends and swirls. |
| `field.random` | White Noise | Pure grain — every point gets an unrelated value. Great for sparkle. |

### Math — Combine and reshape values.

| Type | Node | What it does |
| --- | --- | --- |
| `math.add` | Add | a + b |
| `math.subtract` | Subtract | a − b |
| `math.multiply` | Multiply | a × b — the workhorse for scaling a pattern. |
| `math.divide` | Divide | a ÷ b, with a zero guard. |
| `math.power` | Power | aᵇ — raising a value sharpens its contrast. |
| `math.modulo` | Modulo | The remainder — repeats a value over and over. |
| `math.abs` | Absolute | Removes the sign, folding negatives onto positives. |
| `math.fract` | Fraction | Keeps only the decimal part — turns a ramp into saw teeth. |
| `math.floor` | Floor | Rounds down to a whole number — makes hard steps. |
| `math.negate` | Negate | Multiplies by −1. |
| `math.min` | Minimum | The smaller of the two. |
| `math.max` | Maximum | The larger of the two. |
| `math.mix` | Mix | Blends between A and B. Works for numbers and colours. |
| `math.clamp` | Clamp | Forces a value to stay inside a range. |
| `math.remap` | Remap | Rescales one range onto another. The most useful node here. |
| `math.smoothstep` | Smooth Step | An S-curve between two edges — softens hard transitions. |
| `math.step` | Step | Outputs 1 above the edge, 0 below — a hard cut. |
| `math.trig` | Trigonometry | sin, cos and friends — repeats a value into waves. |
| `math.smin` | Smooth Union | Blends two values with a soft, organic join — melts shapes together. |

### Colour — Turn values into colour.

| Type | Node | What it does |
| --- | --- | --- |
| `color.solid` | Colour | One flat colour. |
| `color.ramp` | Colour Ramp | Maps a value onto a gradient — this is how patterns become colour. |
| `color.hsv` | Adjust Colour | Nudge hue, saturation and brightness of a colour. |
| `color.blend` | Blend Colours | Combines two colours with a mix amount or a blend mode. |
| `color.palette` | Palette | A curated gradient you can dial through with a single value. |

### Shapes — Start from a solid.

| Type | Node | What it does |
| --- | --- | --- |
| `shape.plane` | Plane | A flat subdivided sheet. |
| `shape.sphere` | Sphere | A smooth ball. |
| `shape.box` | Box | A cube you can subdivide. |
| `shape.torus` | Torus | A doughnut. |
| `shape.knot` | Torus Knot | A looping woven tube. |
| `shape.ico` | Icosphere | A perfectly even sphere — the best base for faceted art. |
| `shape.cylinder` | Cylinder | A tube with flat ends. |
| `shape.cone` | Cone | A tapering spike. |
| `shape.capsule` | Capsule | A pill — great base for blobby creatures. |
| `shape.circle` | Disc | A flat filled circle. |

### Deform — Bend, twist and merge meshes.

| Type | Node | What it does |
| --- | --- | --- |
| `geo.displace` | Displace | Push every vertex along a direction by the amount a field describes. |
| `geo.twist` | Twist | Rotate the shape progressively along an axis. |
| `geo.bend` | Bend | Curl the shape around an axis, like bending a ruler. |
| `geo.transform` | Transform | Move, rotate and scale a mesh. |
| `geo.merge` | Merge | Join several meshes into one. Drag more wires onto the socket to add. |
| `geo.refine` | Refine | Adds vertices so painted detail stays smooth instead of faceted. |

### Particles — Scatter points through space.

| Type | Node | What it does |
| --- | --- | --- |
| `points.scatter` | Scatter on Surface | Sprinkle points across a mesh, keeping only those a density field allows. |
| `points.volume` | Fill Volume | Fill a box with points, keeping only the ones a density field allows. |
| `points.grid` | Point Grid | A regular lattice of points — tidy, ordered particle fields. |

### Material — How a surface reacts to light.

| Type | Node | What it does |
| --- | --- | --- |
| `material.standard` | Standard Material | The everyday lit surface. Drive Colour with a ramp to paint patterns. |
| `material.physical` | Physical Material | Adds clear coat, glass transmission and thin-film shimmer. |
| `material.toon` | Toon Material | Banded cartoon lighting with a hard outline-friendly look. |
| `material.basic` | Unlit Material | Ignores all lighting — pure colour, exactly as you set it. |
| `material.normal` | Normal Debug | Shows surface direction as colour — useful for checking a mesh. |
| `material.points` | Points Material | Sizes, shapes and colours the particle cloud. |

### Scene — Sky, fog and camera.

| Type | Node | What it does |
| --- | --- | --- |
| `scene.sky` | Sky | The backdrop and the reflections on your surface. |
| `scene.fog` | Fog | Fade the distance into a colour for depth and atmosphere. |
| `scene.camera` | Camera | Starting view, field of view and an optional slow orbit. |

### Lights — Illuminate the scene.

| Type | Node | What it does |
| --- | --- | --- |
| `light.preset` | Lighting Preset | A whole lighting rig in one node. |
| `light.ambient` | Ambient Light | Fills every shadow with a flat colour. |
| `light.directional` | Directional Light | A distant sun — parallel rays with sharp shadows. |
| `light.point` | Point Light | A bare bulb glowing in one spot. |
| `light.hemi` | Sky Light | Tints up-facing surfaces with the sky colour and down-facing with the ground. |

### Output — What actually gets rendered.

| Type | Node | What it does |
| --- | --- | --- |
| `output.render` | Render | Everything flows here. This node is what you see in the preview. |

### Notes — Comments and helpers.

| Type | Node | What it does |
| --- | --- | --- |
| `util.note` | Note | A sticky note — leave yourself a reminder on the canvas. |

---

## Concepts

**Fields vs numbers.** A *number* is one value. A *field* is a function of space — `(x, y, z) → number` — so it describes a pattern over the whole object. Noise, gradients, rings and checkers all output fields. Most numeric knobs accept a field too: drag a wire into *Amount* or *Scale* and the constant is replaced by the pattern, per-vertex. Fields are sampled on the CPU, never in a shader, so displacement and colouring always line up — a bump in the surface is exactly a bump in the pattern.

**Colour ports.** Colour inputs accept a flat hex, an `{r, g, b}` triple, or a *colour field* — a function returning a colour per point. `color.ramp` and `color.palette` turn scalar fields into colour fields; `color.blend` and `color.hsv` combine and adjust them. Scalars landing on a colour port become greyscale, and colours landing on a scalar port become their luminance, so wires rarely fail — they degrade gracefully.

**Vertex-colour baking.** When a material's Colour input is a pattern, the engine samples it at every vertex and bakes the result into the mesh's vertex colours (converted to linear space exactly once, on the way to the GPU). That's why the same noise node can sculpt *and* paint and both stay in sync.

**Groups.** Select nodes and press <kbd>Ctrl</kbd>+<kbd>G</kbd> to wrap them in a labelled, coloured box. Groups are part of the saved document — they're how a graph explains itself. Every preset uses them to mark its stages (Shape → Sculpt → Colour → Scene → Output).

**Bypass.** Press <kbd>B</kbd> with a node selected to bypass it. Deform nodes have a bypass route: geometry passes straight through untouched, so you can A/B the effect without losing your wiring.

**Undo.** Every edit pushes a snapshot onto a history stack (120 steps, with coalescing so a slider drag is one step). <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> walk it.

**Presets.** The gallery (`P`) replaces the current document with a preset's fresh graph. On your very first run — when there's no autosaved document yet — the `starter` preset ("Ripple Sphere") is loaded for you. Your work is autosaved to the browser's local storage after every edit and restored on reload.

**Animation.** `input.time` and `input.keyframes` are dynamic: anything downstream of them re-evaluates every frame while playback runs. Wire Time → Noise's *Offset Z* and the surface flows. <kbd>Space</kbd> pauses and resumes.

**Keyframes.** The Keyframes node draws a curve of value over time in its plot — click to add a key, drag to shape, double-click to remove (the inspector lists every key as `[t][v][ease]` rows too). *Loop* picks the wrap: ping-pong (default), loop or hold once. It follows the playback clock, or plug any number into its bare *Time* socket to drive the curve from a custom source. The classic pairing: Keyframes → **Noise 4D**'s *W* axis — the pattern morphs in place, every frame, instead of sliding.

**Caching.** The engine hashes each node's structure (type + params + incoming wires) and skips unchanged branches — the status bar shows `evaluated / cached / ms` so you can see it working. Only dynamic branches run every frame.

---

## Saving & exporting

Everything is in the toolbar (and the export ▾ menu):

| What | How | Notes |
| --- | --- | --- |
| **Graph JSON** | Save button / <kbd>Ctrl</kbd>+<kbd>S</kbd> | Downloads the whole document — nodes, wires, groups, view. Re-import with the Load button. |
| **PNG** | Camera button (1×) or export ▾ (1× / 2× / 4×) | <kbd>Ctrl</kbd>+<kbd>E</kbd> grabs a 1× PNG of the preview. Higher multiples render the preview larger. |
| **glTF / GLB** | Export ▾ → *glTF (JSON)* or *GLB (binary)* | The 3D scene itself, ready for Blender, a game engine or the web. |
| **Autosave** | Automatic | The current graph is kept in local storage and restored on reload. |

File names follow the graph's name (the preset name, or whatever you've edited it into).

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Tab</kbd> / <kbd>Ctrl</kbd>+<kbd>K</kbd> | Open node search |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | Undo |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd> | Redo |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | Save graph as JSON |
| <kbd>Ctrl</kbd>+<kbd>E</kbd> | Export a 1× PNG |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd> | Delete selection |
| <kbd>Ctrl</kbd>+<kbd>G</kbd> | Group selection |
| <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> | Ungroup |
| <kbd>B</kbd> | Bypass the selected node |
| <kbd>F</kbd> | Frame every node |
| <kbd>A</kbd> | Select every node |
| <kbd>Esc</kbd> | Deselect / close dialog |
| <kbd>Space</kbd> | Pause or resume time |
| <kbd>H</kbd> / <kbd>?</kbd> | This help panel |
| <kbd>P</kbd> | Preset gallery |
| <kbd>1</kbd> / <kbd>2</kbd> | Preview: reset camera / re-frame object |

---

## Project structure

```
flux-forge/
├── index.html            single page: toolbar, node canvas, preview, modals
├── package.json          deps: three · devDeps: vite
└── src/
    ├── main.js           app shell — document lifecycle, evaluation loop,
    │                     toolbar, keyboard shortcuts, export pipeline
    ├── core/             engine + document model (no DOM panels)
    │   ├── manifest.js   the node catalogue: types, params, ports, docs
    │   ├── registry.js   node-definition registry (register / safeDef)
    │   ├── Graph.js      the document: nodes, links, groups, JSON I/O
    │   ├── Engine.js     evaluates the graph backwards from the output,
    │   │                 coerces wire values, caches unchanged branches
    │   ├── values.js     runtime value helpers (number / field / colour)
    │   ├── portTypes.js  port type system + wire compatibility rules
    │   ├── noise.js      deterministic seeded noise, RNG and math helpers
    │   ├── geoUtils.js   geometry helpers (clone, merge, refine, bake)
    │   ├── points.js     particle payload contract (typed-array bundles)
    │   ├── sceneSpec.js  sky / fog / camera / light spec shapes
    │   └── History.js    snapshot-based undo / redo
    ├── nodes/            node implementations, one file per family;
    │                     installNodes() registers them at startup
    ├── editor/           the node canvas — wires, inspector, search
    │                     palette, minimap, marquee, groups
    ├── render/           the three.js preview — scene assembly, camera,
    │                     PNG screenshots, glTF/GLB export
    ├── styles/           CSS (theme variables, graph + panel styling)
    └── presets/
        ├── dsl.js        makeGraph() — the tuple DSL presets are written in
        └── index.js      the preset gallery (PRESETS)
```

The dependency rule: `core/` knows nothing about the DOM or the panels; `nodes/` implement behaviour against the manifest; `editor/` and `render/` are opaque panels driven by `main.js`.

---

## Extending it

Adding a node takes two steps — one in the catalogue, one in the code. Because the implementation *imports its schema from the manifest*, the search palette, the inspector and the docs all pick it up automatically.

**1. Add an entry to `src/core/manifest.js`** (inside the `MANIFEST` array, in the right category section):

```js
def({
  type: 'field.bands',          // unique, `<family>.<name>`
  label: 'Bands',
  category: 'field',
  desc: 'Diagonal soft bands across the object.',
  inputs: [
    slider('frequency', 'Frequency', 6, 0, 40, 0.1),
  ],
  outputs: [out('out', 'Field', 'field')],
}),
```

**2. Implement it** in the matching file under `src/nodes/`, pulling the schema back out of the manifest and attaching the `eval` function:

```js
// src/nodes/field.js
import { register } from '../core/registry.js';
import { manifestDef } from '../core/manifest.js';

register({
  ...manifestDef('field.bands'),
  eval(ctx, inputs) {
    // `inputs.frequency` arrives already coerced to a field function;
    // fold it into one constant number for the whole object.
    const k = ctx.sample(inputs.frequency, 0, 0, 0) * Math.PI;
    // A field is just a function of space: (x, y, z) -> number.
    return { out: (x, y, z) => Math.abs(Math.sin((x + y) * k)) };
  },
});
```

Make sure the file is imported from `src/nodes/index.js` so `installNodes()` (called once at startup by `main.js`) registers it.

A few rules the engine enforces:

- `eval(ctx, inputs)` returns `{ portKey: value }` — keys must match the `outputs` you declared. Geometry nodes return `{ out: bufferGeometry }`, particle nodes return `{ out: pointsPayload }`, scene nodes return plain spec objects.
- Inputs arrive **already coerced** to their declared port type: a `number` input is a plain number, a `field` input is a function (or a tagged constant field), a `color` input is whatever shape the wire carried — use `ctx.sample` / `ctx.sampleColor` to read it at a point.
- Never mutate geometry you were handed — the engine caches objects between frames. Clone first (`ctx.graph`-side helpers live in `src/core/geoUtils.js`).
- `ctx` also gives you `ctx.time`, a per-node `ctx.seed`, `ctx.noise(seed)` (memoised per node), `ctx.rng`, and the math helpers (`fbm`, `voronoi`, `smoothstep`, `clampNum`, `lerpNum`, `fract`, `TAU`) plus `ctx.error(msg)` / `ctx.warn(msg)` to surface problems in the preview.

**Adding a preset** is even easier: build a graph with the tuple DSL in `src/presets/dsl.js` and push an entry onto `PRESETS` in `src/presets/index.js` — `{ id, title, blurb, color, category, nodes, graph: () => makeGraph({ … }) }`. Every preset in the gallery is ~40 lines of that DSL, grouped and laid out left-to-right.

---

## License

MIT — fork it, bend it, melt it with Smooth Union.
