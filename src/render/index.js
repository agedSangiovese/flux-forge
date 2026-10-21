/**
 * three.js preview renderer + exporter.
 *
 * createPreview(options) owns a WebGLRenderer, a dedicated Scene (the artwork
 * arrives as an engine scene-spec — see core/sceneSpec.js), an orbit camera
 * and the RAF loop. It is deliberately the only place that touches the GL
 * context; the graph engine hands it plain specs plus a cached Object3D.
 *
 * options: { canvas, overlayEl, triEl, onFrame(elapsed, dt), onFps(fps) }
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEnvironmentManager } from './environment.js';
import { LightRig } from './lights.js';
import { captureScreenshot, exportSceneGLTF } from './export.js';

const DEFAULT_DISTANCE = 6;
const DEFAULT_FOV = 45;
const DEFAULT_TARGET_Y = 0;
const FRAME_MARGIN = 1.18;

/** Classic 3/4 view used by resetCamera() and as a sane initial heading. */
const HOME_DIR = new THREE.Vector3(1, 0.68, 1).normalize();

export function createPreview(options = {}) {
  const { canvas, overlayEl, triEl, onFrame, onFps } = options;

  let renderer = null;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: false,
    });
  } catch (err) {
    console.error('[preview] WebGL is unavailable', err);
    return deadPreview(
      options,
      'WebGL could not start on this device — the 3D preview is disabled. ' +
        'Try enabling hardware acceleration or a different browser.',
    );
  }

  return livePreview(options, renderer);
}

// --------------------------------------------------------------------- dead

/** A fully functional no-op preview for machines without WebGL. */
function deadPreview(options, reason) {
  const { overlayEl, triEl } = options;
  setStatusOn(overlayEl, { error: reason });
  if (triEl) triEl.textContent = '—';

  let playing = true;
  let time = 0;
  return {
    setScene() {},
    setStatus: (s) => setStatusOn(overlayEl, s || {}),
    setPlaying: (v) => { playing = !!v; },
    isPlaying: () => playing,
    getTime: () => time,
    setTime: (t) => { time = Number.isFinite(t) ? t : 0; },
    resetCamera() {},
    frameObject() {},
    screenshot: async () => { throw new Error('WebGL is unavailable — cannot capture a screenshot.'); },
    exportGLTF: async () => { throw new Error('WebGL is unavailable — cannot export glTF.'); },
    resize() {},
    dispose() {},
  };
}

function setStatusOn(el, status) {
  if (!el) return;
  const text = (status && (status.error || status.message)) || '';
  el.textContent = text;
  el.classList.toggle('error', !!(status && status.error));
}

// --------------------------------------------------------------------- live

function livePreview(options, renderer) {
  const { canvas, overlayEl, triEl, onFrame, onFps } = options;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  renderer.setPixelRatio(Math.min(dpr, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.05, 4000);
  camera.position.copy(HOME_DIR).multiplyScalar(DEFAULT_DISTANCE);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, DEFAULT_TARGET_Y, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.02;
  controls.maxDistance = 2000;
  controls.update();

  // The engine swaps `spec.object` in and out of this stable, named child.
  const artworkHolder = new THREE.Group();
  artworkHolder.name = 'artwork';
  scene.add(artworkHolder);

  const envManager = createEnvironmentManager(renderer);
  const lightRig = new LightRig(scene);

  // Reused scratch objects — the render loop must not allocate.
  const scratchBox = new THREE.Box3();
  const scratchSphere = new THREE.Sphere();
  const scratchCenter = new THREE.Vector3();
  const scratchDir = new THREE.Vector3();
  const bgColor = new THREE.Color('#0b1020');
  const artBox = new THREE.Box3();
  const artSphere = new THREE.Sphere();

  // ------------------------------------------------------------ state
  let disposed = false;
  let rafId = 0;
  let lastNow = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  let elapsed = 0;
  let playing = true;
  let fpsFrames = 0;
  let fpsWindow = 0;

  let lastSpec = null;
  let lastObject = null;
  let lastLightsKey = null;
  let lastSkyKey = null;
  let lastFogKey = null;
  let autoFramedObject = null;
  let appliedShadows = null;
  let appliedExposure = null;
  const appliedCam = { distance: DEFAULT_DISTANCE, fov: DEFAULT_FOV, targetY: DEFAULT_TARGET_Y };
  const shownStats = { t: -1, p: -1 };

  // ------------------------------------------------------- 2D shader quad
  //
  // Shader Canvas documents render a generated fragment shader on a
  // fullscreen triangle in its own scene — no camera, lights or sky involved.
  // Standard uniforms (u_time, u_resolution, u_mouse, u_frame) are owned here;
  // texture samplers arrive with the spec. u_resolution is re-synced from the
  // real drawing buffer on every render (via onBeforeRender), so hi-res PNG
  // exports get the right aspect without any special-casing.
  const SHADER_VERT = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
  let shaderMode = false;
  let shaderScene = null;
  let shaderCam = null;
  let shaderMat = null;
  let shaderFrag = null;
  let shaderFrame = 0;
  const shaderMouse = { x: 0, y: 0, cx: 0, cy: 0, down: false };
  const scratchDBSize = new THREE.Vector2(1, 1);

  function ensureShaderStage() {
    if (shaderScene) return;
    shaderScene = new THREE.Scene();
    shaderCam = new THREE.Camera();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    shaderMat = new THREE.ShaderMaterial({
      vertexShader: SHADER_VERT,
      fragmentShader: 'void main() { gl_FragColor = vec4(0.0); }',
      uniforms: {
        u_time: { value: 0 },
        u_resolution: { value: new THREE.Vector2(1, 1) },
        u_mouse: { value: new THREE.Vector4(0, 0, 0, 0) },
        u_frame: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, shaderMat);
    mesh.frustumCulled = false;
    mesh.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(scratchDBSize);
      shaderMat.uniforms.u_resolution.value.set(scratchDBSize.x, scratchDBSize.y);
    };
    shaderScene.add(mesh);
  }

  function applyShader(spec) {
    ensureShaderStage();
    if (spec.fragment !== shaderFrag) {
      shaderFrag = spec.fragment;
      shaderMat.fragmentShader = spec.fragment;
      // Drop stale samplers, keep the four standard uniforms.
      for (const key of Object.keys(shaderMat.uniforms)) {
        if (key.startsWith('u_tex_')) delete shaderMat.uniforms[key];
      }
      shaderMat.needsUpdate = true;
      shaderFrame = 0;
    }
    for (const [name, value] of Object.entries(spec.uniforms || {})) {
      shaderMat.uniforms[name] = { value: value ?? null };
    }
  }

  function trackShaderMouse() {
    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: r.height - (e.clientY - r.top) };
    };
    canvas.addEventListener('pointermove', (e) => {
      const p = toLocal(e);
      shaderMouse.x = p.x;
      shaderMouse.y = p.y;
    });
    canvas.addEventListener('pointerdown', (e) => {
      const p = toLocal(e);
      shaderMouse.cx = p.x;
      shaderMouse.cy = p.y;
      shaderMouse.down = true;
    });
    window.addEventListener('pointerup', () => {
      shaderMouse.down = false;
    });
  }

  function syncShaderFrame() {
    if (!shaderMode || !shaderMat) return;
    const pr = renderer.getPixelRatio() || 1;
    shaderMat.uniforms.u_time.value = elapsed;
    shaderMat.uniforms.u_frame.value = shaderFrame++;
    shaderMat.uniforms.u_mouse.value.set(
      shaderMouse.x * pr,
      shaderMouse.y * pr,
      shaderMouse.cx * pr,
      shaderMouse.cy * pr
    );
  }

  // ------------------------------------------------------- status / stats

  function setStatus(status) {
    setStatusOn(overlayEl, status || {});
  }

  function updateStats(stats) {
    const t = Math.max(0, Math.round((stats && stats.triangles) || 0));
    const p = Math.max(0, Math.round((stats && stats.points) || 0));
    if (t === shownStats.t && p === shownStats.p) return;
    shownStats.t = t;
    shownStats.p = p;
    if (!triEl) return;
    const parts = [];
    if (t) parts.push(`${t.toLocaleString('en-US')} tris`);
    if (p) parts.push(`${p.toLocaleString('en-US')} pts`);
    triEl.textContent = parts.length ? parts.join(' · ') : '0 tris';
  }

  // ------------------------------------------------------------- artwork

  function swapObject(obj) {
    if (obj === lastObject) return false;
    while (artworkHolder.children.length) artworkHolder.remove(artworkHolder.children[0]);
    if (obj) {
      if (obj.parent) obj.removeFromParent();
      artworkHolder.add(obj);
    }
    lastObject = obj || null;
    return true;
  }

  /** Bounding sphere of the current artwork (unit sphere at origin if empty). */
  function artworkSphere(target) {
    artBox.makeEmpty();
    if (lastObject) {
      try {
        artBox.setFromObject(lastObject);
      } catch {
        /* degenerate geometry */
      }
    }
    if (artBox.isEmpty() || !Number.isFinite(artBox.min.x)) {
      target.center.set(0, appliedCam.targetY, 0);
      target.radius = 1;
      return target;
    }
    artBox.getBoundingSphere(target);
    if (!Number.isFinite(target.radius) || target.radius <= 0) {
      target.center.set(0, appliedCam.targetY, 0);
      target.radius = 1;
    }
    return target;
  }

  function artworkCenter(target) {
    artworkSphere(artSphere);
    return target.copy(artSphere.center);
  }

  function applyArtworkShadowFlags(on) {
    if (!lastObject) return;
    lastObject.traverse((child) => {
      if (child.isMesh || child.isInstancedMesh || child.isSkinnedMesh) {
        child.castShadow = on;
        child.receiveShadow = on;
      }
    });
  }

  // ------------------------------------------------------------- shadows

  function applyShadows(shadowsEnabled) {
    artworkSphere(artSphere);
    const casting = lightRig.fitShadows(shadowsEnabled, artSphere);
    renderer.shadowMap.enabled = !!casting;
    applyArtworkShadowFlags(!!casting);
    appliedShadows = shadowsEnabled;
  }

  // ------------------------------------------------------- lights & sky

  function rebuildLights(specs) {
    artworkCenter(scratchCenter);
    lightRig.rebuild(specs, scratchCenter);
  }

  function applySky(sky) {
    if (!sky) {
      scene.background = null;
      scene.environment = null;
      return;
    }
    const envTex = envManager.envTexture(sky.environment || 'none');
    scene.environment = envTex;
    scene.environmentIntensity = Number.isFinite(sky.envIntensity) ? sky.envIntensity : 1;
    scene.backgroundBlurriness = Number.isFinite(sky.blur) ? THREE.MathUtils.clamp(sky.blur, 0, 1) : 0;

    switch (sky.mode) {
      case 'gradient':
        scene.background = envManager.gradientTexture(sky.color, sky.color2, sky.angle);
        break;
      case 'solid':
        bgColor.set(sky.color || '#0b1020');
        scene.background = bgColor;
        break;
      case 'transparent':
        scene.background = null;
        break;
      case 'environment':
      default:
        if (envTex) scene.background = envTex;
        else {
          // 'none' environment in environment mode — keep the canvas readable.
          bgColor.set(sky.color || '#0b1020');
          scene.background = bgColor;
        }
        break;
    }
  }

  function applyFog(fog) {
    if (!fog || fog.mode === 'off') {
      scene.fog = null;
    } else if (fog.mode === 'linear') {
      scene.fog = new THREE.Fog(fog.color || '#c9d6e8', fog.near ?? 6, fog.far ?? 40);
    } else {
      scene.fog = new THREE.FogExp2(fog.color || '#c9d6e8', fog.density ?? 0.03);
    }
  }

  // -------------------------------------------------------------- camera

  function applyCameraSpec(cam, opts) {
    if (!cam) return;
    const { force = false, first = false } = opts || {};

    if (force || first || Math.abs(cam.fov - appliedCam.fov) > 0.01) {
      camera.fov = Number.isFinite(cam.fov) ? cam.fov : DEFAULT_FOV;
      camera.updateProjectionMatrix();
      appliedCam.fov = camera.fov;
    }

    if (force || first || Math.abs(cam.targetY - appliedCam.targetY) > 1e-4) {
      controls.target.y = Number.isFinite(cam.targetY) ? cam.targetY : DEFAULT_TARGET_Y;
      appliedCam.targetY = controls.target.y;
    }

    // Only pull the camera back to spec.distance when the spec's own value
    // changed — never fight a manual orbit/zoom mid-session.
    const wanted = Number.isFinite(cam.distance) ? cam.distance : DEFAULT_DISTANCE;
    if (force || first || Math.abs(wanted - appliedCam.distance) > 1e-4) {
      scratchDir.copy(camera.position).sub(controls.target);
      if (scratchDir.lengthSq() < 1e-8) scratchDir.copy(HOME_DIR);
      scratchDir.normalize().multiplyScalar(wanted);
      camera.position.copy(controls.target).add(scratchDir);
      appliedCam.distance = wanted;
    }

    controls.autoRotate = !!cam.autoRotate;
    controls.autoRotateSpeed = Number.isFinite(cam.speed) ? cam.speed : 1;
    controls.update();
  }

  function frameObject() {
    let radius = 0.5;
    if (lastObject) {
      scratchBox.makeEmpty();
      try {
        scratchBox.setFromObject(lastObject);
      } catch {
        /* degenerate */
      }
      if (!scratchBox.isEmpty() && Number.isFinite(scratchBox.min.x)) {
        scratchBox.getBoundingSphere(scratchSphere);
        radius = Math.max(scratchSphere.radius, 0.05);
        scratchCenter.copy(scratchSphere.center);
      } else {
        scratchCenter.set(0, appliedCam.targetY, 0);
      }
    } else {
      scratchCenter.set(0, appliedCam.targetY, 0);
      radius = 0.5;
    }

    const vFov = (camera.fov * Math.PI) / 180;
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const dist = Math.max(radius / Math.sin(vFov / 2), radius / Math.sin(hFov / 2)) * FRAME_MARGIN;

    scratchDir.copy(camera.position).sub(controls.target);
    if (scratchDir.lengthSq() < 1e-8) scratchDir.copy(HOME_DIR);
    scratchDir.normalize();

    controls.target.copy(scratchCenter);
    camera.position.copy(scratchCenter).addScaledVector(scratchDir, dist);
    controls.update();
  }

  function resetCamera() {
    const cam = (lastSpec && lastSpec.camera) || null;
    const dist = cam && Number.isFinite(cam.distance) ? cam.distance : appliedCam.distance;
    const fov = cam && Number.isFinite(cam.fov) ? cam.fov : DEFAULT_FOV;
    const targetY = cam && Number.isFinite(cam.targetY) ? cam.targetY : DEFAULT_TARGET_Y;

    camera.fov = fov;
    camera.updateProjectionMatrix();
    controls.target.set(0, targetY, 0);
    camera.position.copy(controls.target).addScaledVector(HOME_DIR, dist);
    appliedCam.distance = dist;
    appliedCam.fov = fov;
    appliedCam.targetY = targetY;
    controls.update();
  }

  // ------------------------------------------------------------ setScene

  function setScene(spec, force = false) {
    if (spec === lastSpec && !force) return;
    const prevSpec = lastSpec;
    lastSpec = spec || null;

    // ---- 2D shader documents bypass the whole 3D path: no object, lights,
    //      sky or camera apply. The rest of this function runs on empty
    //      values, which safely no-ops back to neutral.
    shaderMode = !!(spec && spec.shader);
    if (shaderMode) applyShader(spec.shader);

    if (!spec) {
      swapObject(null);
      updateStats(null);
      lastLightsKey = '[]';
      lightRig.rebuild([], scratchCenter.set(0, 0, 0));
      appliedShadows = null;
      applyShadows(false);
      return;
    }

    const objectChanged = swapObject(spec.object || null);

    // ---- lights (JSON compare: spec arrays are rebuilt per evaluation, so
    //      identity comparison would rebuild the rig every frame)
    let lightsChanged = false;
    const lightsKey = JSON.stringify(spec.lights || []);
    if (force || lightsKey !== lastLightsKey) {
      lastLightsKey = lightsKey;
      rebuildLights(spec.lights || []);
      lightsChanged = true;
    }
    // Re-run shadow fitting whenever the rig or the artwork changed — a fresh
    // object needs its castShadow/receiveShadow flags even if the mode is
    // unchanged.
    if (force || lightsChanged || objectChanged || spec.shadows !== appliedShadows) {
      applyShadows(!!spec.shadows);
    }

    // ---- sky + fog
    const skyKey = JSON.stringify(spec.sky || null);
    if (force || skyKey !== lastSkyKey) {
      lastSkyKey = skyKey;
      applySky(spec.sky || null);
    }

    const fogKey = JSON.stringify(spec.fog || null);
    if (force || fogKey !== lastFogKey) {
      lastFogKey = fogKey;
      applyFog(spec.fog || null);
    }

    // ---- exposure
    const exposure = Number.isFinite(spec.exposure) ? spec.exposure : 1;
    if (force || exposure !== appliedExposure) {
      renderer.toneMappingExposure = exposure;
      appliedExposure = exposure;
    }

    // ---- camera (`first` forces one full apply on the very first spec).
    // Note: `force` deliberately does NOT re-apply distance/fov — a history
    // restore or theme toggle must not yank a manually zoomed camera around.
    applyCameraSpec(spec.camera, { first: !prevSpec });

    // ---- stats
    updateStats(spec.stats || null);
    if (shaderMode && triEl) {
      // A shader is one fullscreen triangle — say so instead of "0 tris".
      // Poison the cache so switching back to 3D always redraws the label.
      shownStats.t = -1;
      shownStats.p = -1;
      triEl.textContent = '2D shader';
    }

    // ---- auto-frame newly loaded artwork
    if (spec.autoFrame && spec.object && spec.object !== autoFramedObject) {
      autoFramedObject = spec.object;
      frameObject();
    }
  }

  // ---------------------------------------------------------------- loop

  function tick(nowMs) {
    if (disposed) return;
    rafId = requestAnimationFrame(tick);

    const now = nowMs / 1000;
    let rawDt = now - lastNow;
    lastNow = now;
    if (!Number.isFinite(rawDt) || rawDt < 0) rawDt = 0;
    if (rawDt > 0.5) rawDt = 0.5; // tab was backgrounded — don't leap
    const dt = Math.min(rawDt, 0.1);

    if (playing) elapsed += dt;

    controls.update(rawDt);
    if (shaderMode && shaderScene) {
      syncShaderFrame();
      renderer.render(shaderScene, shaderCam);
    } else {
      renderer.render(scene, camera);
    }

    if (onFrame) {
      try {
        onFrame(elapsed, dt);
      } catch (err) {
        console.error('[preview] onFrame callback threw', err);
      }
    }

    fpsFrames++;
    fpsWindow += rawDt;
    if (fpsWindow >= 1) {
      if (onFps) {
        try {
          onFps(fpsFrames / fpsWindow);
        } catch (err) {
          console.error('[preview] onFps callback threw', err);
        }
      }
      fpsFrames = 0;
      fpsWindow = 0;
    }
  }

  // -------------------------------------------------------------- resize

  function resize() {
    const parent = canvas && canvas.parentElement;
    let w = canvas ? canvas.clientWidth : 0;
    let h = canvas ? canvas.clientHeight : 0;
    if ((!w || !h) && parent) {
      w = w || parent.clientWidth;
      h = h || parent.clientHeight;
    }
    // A 0×0 canvas (hidden panel, collapsed layout) still needs a real buffer.
    w = Math.max(1, Math.floor(w || 1));
    h = Math.max(1, Math.floor(h || 1));

    renderer.setSize(w, h, false);
    const aspect = w / h;
    if (Number.isFinite(aspect) && aspect > 0 && Math.abs(camera.aspect - aspect) > 1e-4) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------- context events

  function onContextLost(event) {
    event.preventDefault();
    setStatus({ error: 'The GPU context was lost — waiting for it to recover…' });
  }
  function onContextRestored() {
    setStatus({ error: null });
    resize();
  }
  canvas.addEventListener('webglcontextlost', onContextLost, false);
  canvas.addEventListener('webglcontextrestored', onContextRestored, false);
  trackShaderMouse();

  const onWindowResize = () => resize();
  window.addEventListener('resize', onWindowResize);

  // Belt and braces: main.js calls resize() on layout changes, but a
  // ResizeObserver keeps the buffer honest even if something is missed.
  let observer = null;
  const observeTarget = (canvas && canvas.parentElement) || null;
  if (observeTarget && typeof ResizeObserver !== 'undefined') {
    try {
      observer = new ResizeObserver(() => resize());
      observer.observe(observeTarget);
    } catch {
      observer = null;
    }
  }

  resize();
  applySky(null); // neutral clear so the very first frames are never black
  rafId = requestAnimationFrame(tick);

  // --------------------------------------------------------------- api

  return {
    setScene,
    setStatus,
    setPlaying(v) {
      playing = !!v;
    },
    isPlaying: () => playing,
    getTime: () => elapsed,
    setTime(t) {
      elapsed = Number.isFinite(t) ? t : 0;
    },
    resetCamera,
    frameObject,
    screenshot(opts) {
      // In shader mode the artwork lives in its own scene.
      if (shaderMode && shaderScene) {
        return captureScreenshot(renderer, shaderScene, shaderCam, canvas, opts || {});
      }
      return captureScreenshot(renderer, scene, camera, canvas, opts || {});
    },
    exportGLTF(opts) {
      return exportSceneGLTF(lastObject, lastSpec ? lastSpec.lights : [], opts || {});
    },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onWindowResize);
      if (observer) observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onContextLost, false);
      canvas.removeEventListener('webglcontextrestored', onContextRestored, false);

      controls.dispose();
      lightRig.dispose();
      envManager.dispose();

      // The artwork came from the engine; at teardown nothing else will free it.
      if (lastObject) {
        lastObject.traverse((child) => {
          if (child.geometry) child.geometry.dispose();
          const mats = child.material
            ? Array.isArray(child.material) ? child.material : [child.material]
            : [];
          for (const m of mats) if (m && typeof m.dispose === 'function') m.dispose();
        });
      }

      renderer.dispose();
      if (typeof renderer.forceContextLoss === 'function') {
        try {
          renderer.forceContextLoss();
        } catch {
          /* already gone */
        }
      }
    },
  };
}
