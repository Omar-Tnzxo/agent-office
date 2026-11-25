// A visitor on its way between the elevator, its lobby spot and a desk: down off a chair, along the
// floor round the furniture, and up onto a chair, the way a worker called to a meeting walks in (see
// Arrivals in features/workers/leaving.ts).
import * as THREE from 'three';
import type { Pt } from '../../../shared/nav';
import type { Worker } from '../../world/character';
import type { DeskView } from '../../world/types';

/** Walking pace, in m/s. */
const PACE = 2.6;
/** Seconds hopping down off a chair, or up onto one. */
const HOP = 0.55;
/** A visitor's feet are this far above its origin, so on the floor its origin is this far under it. */
export const FEET = 0.07;
/** Seconds between one visitor and the next stepping out of the elevator. */
export const SPACING = 0.9;

export interface Walk {
  /** Its corners: where it starts (or lands, getting down off a chair), then on to where it's going. */
  way: Pt[];
  /** The point on `way` it's walking to. */
  next: number;
  /** Seconds before it steps out of the elevator: it isn't there to see until then. */
  wait: number;
  /** The way it's walking (rotation around y; 0 is +z). */
  heading: number;
  /** Seconds until its next footstep. */
  stepIn: number;
  /** Getting down off a chair: where it sat, how big it was there, and how far through the hop it is (0 to 1). */
  down: { from: THREE.Vector3; scale: number; p: number } | null;
  /** The desk it sits down at when it gets there, or none: it stands, turned `face`. */
  to: DeskView | null;
  face: number;
  /** The hop up onto the chair: from where on the floor, to where in the world and how big, and how far through. */
  up: { from: THREE.Vector3; seat: THREE.Vector3; scale: number; p: number } | null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const { lerp } = THREE.MathUtils;

/** A walk along `way`, for a visitor that is at its first point (or lands there, with `down`). */
export function walkAlong(way: Pt[], to: DeskView | null, face: number, heading: number, wait = 0, down: Walk['down'] = null): Walk {
  return { way, next: down ? 0 : 1, wait, heading, stepIn: 0, down, to, face, up: null };
}

/**
 * Moves `model` (in the room's own space, not a seat's) along its walk; false once it's there: beside
 * its lobby spot turned the way it faces, or up on its chair, ready to be sat down in it.
 */
export function stepWalk(model: Worker, w: Walk, dt: number, footstep: (x: number, y: number, z: number) => void): boolean {
  const { root } = model;
  const pos = root.position;
  model.walking = false;
  if (w.wait > 0) {
    w.wait -= dt;
    root.visible = w.wait <= 0;
    return true;
  }
  if (w.down) {
    // Down off the seat in a little arc, growing back to its own size, turning to where it's going.
    const d = w.down;
    d.p = Math.min(1, d.p + dt / HOP);
    const [x0, z0] = w.way[0];
    pos.set(lerp(d.from.x, x0, d.p), lerp(d.from.y, -FEET, d.p) + Math.sin(d.p * Math.PI) * 0.35, lerp(d.from.z, z0, d.p));
    root.scale.setScalar(lerp(d.scale, 1, d.p));
    if (w.way.length > 1) root.rotation.y += wrap(Math.atan2(w.way[1][0] - x0, w.way[1][1] - z0) - root.rotation.y) * Math.min(1, dt * 7);
    if (d.p >= 1) {
      w.down = null;
      w.next = 1;
    }
    return true;
  }
  if (w.up) {
    // Up onto the chair the same way, turning to face the desk.
    const u = w.up;
    u.p = Math.min(1, u.p + dt / HOP);
    pos.set(lerp(u.from.x, u.seat.x, u.p), lerp(u.from.y, u.seat.y, u.p) + Math.sin(u.p * Math.PI) * 0.35, lerp(u.from.z, u.seat.z, u.p));
    root.scale.setScalar(lerp(1, u.scale, u.p));
    root.rotation.y += wrap(w.face - root.rotation.y) * Math.min(1, dt * 9);
    return u.p < 1;
  }
  let move = PACE * dt;
  while (move > 0 && w.next < w.way.length) {
    const [x, z] = w.way[w.next];
    const dx = x - pos.x;
    const dz = z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) w.heading = Math.atan2(dx, dz);
    if (d <= move) {
      pos.x = x;
      pos.z = z;
      move -= d;
      w.next++;
    } else {
      pos.x += (dx / d) * move;
      pos.z += (dz / d) * move;
      move = 0;
    }
  }
  pos.y = -FEET;
  if (w.next < w.way.length) {
    root.rotation.y += wrap(w.heading - root.rotation.y) * Math.min(1, dt * 8);
    model.walking = true;
    w.stepIn -= dt;
    if (w.stepIn <= 0) {
      w.stepIn += Math.PI / 9;
      footstep(pos.x, pos.y, pos.z);
    }
    return true;
  }
  if (w.to) {
    // Beside its chair: up it goes.
    const seat = w.to.seatAnchor.getWorldPosition(new THREE.Vector3());
    w.up = { from: pos.clone(), seat, scale: w.to.seatAnchor.getWorldScale(new THREE.Vector3()).x, p: 0 };
    return true;
  }
  // At its spot: round to face the room.
  const off = wrap(w.face - root.rotation.y);
  root.rotation.y += off * Math.min(1, dt * 8);
  return Math.abs(off) > 0.04;
}
