import * as THREE from 'three';
import type { HandoffKind } from '../../../shared/protocol';
import { mesh, toon } from '../../world/toon';

// The office's paperwork: a manila folder with a sheet sticking out of it (a ticket handed on, its
// tab blue when it goes in for review and red when it's sent back), and a desk tray to stack them in.
// Each is built lying flat, in its own frame: x across, y up, z its length.

const W = 0.26;
const L = 0.2;
const T = 0.012;
const TAB: Record<HandoffKind, string> = { handoff: '#e0b45c', review: '#4cc9f0', return: '#ef476f' };

/** Shared by every folder, made the first time one is. */
let geos: { cover: THREE.BufferGeometry; sheet: THREE.BufferGeometry; tab: THREE.BufferGeometry; line: THREE.BufferGeometry } | null = null;

function shapes() {
  geos ??= {
    cover: new THREE.BoxGeometry(W, T, L),
    sheet: new THREE.BoxGeometry(W * 0.88, T * 0.5, L * 0.92),
    tab: new THREE.BoxGeometry(W * 0.34, T * 1.05, 0.04),
    line: new THREE.BoxGeometry(W * 0.6, T * 0.3, 0.012),
  };
  return geos;
}

/** A manila folder, lying flat, its tab at its far end (-z). */
export function folderModel(kind: HandoffKind): THREE.Group {
  const g = new THREE.Group();
  const s = shapes();
  g.add(mesh(s.cover, toon('#f1d38a'), 0, T / 2, 0, false));
  // A sheet sticking out of the side, with a couple of lines on it, and the cover over it.
  g.add(mesh(s.sheet, toon('#fffaf3'), 0.025, T + T * 0.25, -0.012, false));
  for (const z of [-0.04, 0]) g.add(mesh(s.line, toon('#8d99ae'), 0.03, T * 1.55, z, false));
  const top = mesh(s.cover, toon('#f6dc9b'), -0.01, T * 1.9, 0.008, false);
  top.scale.set(0.96, 0.6, 0.94);
  g.add(top);
  g.add(mesh(s.tab, toon(TAB[kind]), -W * 0.22, T * 1.9, -L / 2 - 0.012, false));
  return g;
}

/** How high each folder in a tray sits over the one under it, and how many are drawn before the count says the rest. */
export const STACK_STEP = 0.016;
export const STACK_SHOWN = 5;

/** Shared by every tray, made the first time one is: trays come and go with the visitors all day. */
let trayGeos: { base: THREE.BufferGeometry; side: THREE.BufferGeometry; back: THREE.BufferGeometry; lip: THREE.BufferGeometry } | null = null;

/** A low wire-and-wood desk tray, open at the front (+z), to put folders in. */
export function trayModel(): THREE.Group {
  trayGeos ??= {
    base: new THREE.BoxGeometry(0.32, 0.014, 0.26),
    side: new THREE.BoxGeometry(0.014, 0.07, 0.26),
    back: new THREE.BoxGeometry(0.33, 0.07, 0.014),
    lip: new THREE.BoxGeometry(0.33, 0.03, 0.014),
  };
  const g = new THREE.Group();
  const wood = toon('#7f5539');
  const rim = toon('#adb5bd');
  g.add(mesh(trayGeos.base, wood, 0, 0.007, 0, false));
  for (const x of [-0.16, 0.16]) g.add(mesh(trayGeos.side, rim, x, 0.035, 0, false));
  g.add(mesh(trayGeos.back, rim, 0, 0.035, -0.13, false));
  g.add(mesh(trayGeos.lip, rim, 0, 0.015, 0.13, false));
  return g;
}
