/**
 * Shape nodes — every graph starts from one of these.
 *
 * These are the only places raw THREE geometries are created; everything
 * downstream clones rather than mutates, so a shape can safely feed several
 * deformers at once.
 */
import * as THREE from 'three';
import { define } from './define.js';

const finite = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
/** Round + clamp a segment count so a wild knob can never hang the browser. */
const seg = (v, lo, hi, fb) => {
  const n = Math.round(finite(v, fb));
  return n < lo ? lo : n > hi ? hi : n;
};
const size = (v, fb) => Math.abs(finite(v, fb));

define('shape.plane', (ctx, i) => ({
  out: new THREE.PlaneGeometry(size(i.width, 2), size(i.height, 2), seg(i.segX, 1, 512, 128), seg(i.segY, 1, 512, 128)),
}));

define('shape.sphere', (ctx, i) => ({
  out: new THREE.SphereGeometry(size(i.radius, 1), seg(i.segX, 4, 256, 96), seg(i.segY, 3, 128, 64)),
}));

define('shape.box', (ctx, i) => {
  const s = seg(i.seg, 1, 96, 16);
  return { out: new THREE.BoxGeometry(size(i.width, 1.4), size(i.height, 1.4), size(i.depth, 1.4), s, s, s) };
});

define('shape.torus', (ctx, i) => ({
  out: new THREE.TorusGeometry(
    size(i.radius, 1),
    size(i.tube, 0.4),
    seg(i.radialSeg, 8, 160, 64),
    seg(i.tubularSeg, 8, 512, 200)
  ),
}));

define('shape.knot', (ctx, i) => ({
  out: new THREE.TorusKnotGeometry(
    size(i.radius, 1),
    size(i.tube, 0.35),
    seg(i.seg, 32, 600, 300), // tubular segments along the loop
    seg(i.tubeSeg, 6, 128, 48), // radial segments around the tube
    seg(i.p, 2, 12, 2),
    seg(i.q, 2, 16, 3)
  ),
}));

define('shape.ico', (ctx, i) => ({
  out: new THREE.IcosahedronGeometry(size(i.radius, 1), seg(i.detail, 0, 5, 3)),
}));

define('shape.cylinder', (ctx, i) => ({
  out: new THREE.CylinderGeometry(
    size(i.radiusTop, 0.6),
    size(i.radiusBottom, 0.6),
    size(i.height, 1.6),
    seg(i.radialSeg, 6, 256, 96),
    seg(i.heightSeg, 1, 160, 48)
  ),
}));

define('shape.cone', (ctx, i) => ({
  out: new THREE.ConeGeometry(
    size(i.radius, 0.8),
    size(i.height, 1.8),
    seg(i.radialSeg, 6, 256, 96),
    seg(i.heightSeg, 1, 160, 48)
  ),
}));

define('shape.capsule', (ctx, i) => ({
  out: new THREE.CapsuleGeometry(
    size(i.radius, 0.55),
    size(i.length, 1.2),
    seg(i.capSeg, 2, 40, 20),
    seg(i.radialSeg, 6, 160, 72)
  ),
}));

define('shape.circle', (ctx, i) => ({
  out: new THREE.CircleGeometry(size(i.radius, 1.2), seg(i.segments, 3, 512, 192)),
}));
