import * as THREE from 'three';
import type { HandoffKind } from '../../../shared/protocol';
import { REVIEW_TABLE } from '../../../shared/tickets';
import type { TextKey } from '../../i18n';
import { mergeByMaterial, mesh, phrasePlane, textPlane, toon, toonUnique } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { STACK_SHOWN, STACK_STEP, folderModel, trayModel } from './folder';

// The review table: a wooden counter against the meeting room's glass, facing the lounge, with a
// cork board on its back edge and two trays on top. The left one holds the tickets in review, the
// right one what waits on the owner, with a lamp beside it that pulses while anything does. Only a
// floor whose repository keeps tickets has it out (see index.ts); E at it opens its window (ui.ts).

/** The trays, in the table's own frame (it's built facing +z): which, and where along it. */
const TRAYS = { review: -0.5, waiting: 0.5 } as const;
export type TrayName = keyof typeof TRAYS;

export interface ReviewTable {
  group: THREE.Group;
  /** Out on this floor, or put away (its collider and what there is to use with it too). */
  setShown(on: boolean): void;
  shown(): boolean;
  /** What's in each tray: a folder per ticket (up to STACK_SHOWN), the rest a count. */
  setTrays(review: readonly HandoffKind[], waiting: number): void;
  /** Where a folder lands in `tray`, in the world. */
  trayTop(tray: TrayName): THREE.Vector3;
  /** Where someone stands to use it, and the way they face. */
  front: { x: number; z: number; rotY: number };
  update(dt: number, t: number): void;
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The review table by the meeting room, for a floor that keeps tickets. */
    review: ReviewTable;
  }
}

/** A stack of folders in a tray, and its count once there are more than it shows. */
function stack(tray: THREE.Group, kinds: readonly HandoffKind[]) {
  for (const c of [...tray.children]) if (c.userData.folder) tray.remove(c);
  kinds.slice(0, STACK_SHOWN).forEach((kind, i) => {
    const f = folderModel(kind);
    f.userData.folder = true;
    f.position.set((i % 2 ? 0.012 : -0.01) * (i % 3), 0.016 + i * STACK_STEP, 0.01);
    f.rotation.y = ((i * 37) % 9) * 0.02 - 0.08;
    tray.add(f);
  });
}

function buildReviewTable(colliders: Collider[]): { table: ReviewTable; interactable: Interactable } {
  const { x, z, width: W, depth: D, height: H } = REVIEW_TABLE;
  const parts = new THREE.Group();
  const wood = toon('#9c6644');
  const woodDark = toon('#7f5539');
  const panel = toon('#e9d8a6');
  // Built facing +z, its back against z = -D/2.
  parts.add(mesh(new THREE.BoxGeometry(W, 0.06, D), wood, 0, H - 0.03, 0));
  parts.add(mesh(new THREE.BoxGeometry(W - 0.12, H - 0.06, D - 0.12), panel, 0, (H - 0.06) / 2, -0.02));
  parts.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.08, D - 0.1), woodDark, 0, 0.04, -0.02));
  // Two doors on the front, with knobs.
  for (const sx of [-1, 1]) {
    parts.add(mesh(new THREE.BoxGeometry(W / 2 - 0.12, H - 0.26, 0.02), toon('#f1e3bf'), sx * (W / 4 - 0.02), (H - 0.06) / 2 + 0.03, D / 2 - 0.07));
    parts.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), woodDark, sx * 0.08, H * 0.55, D / 2 - 0.05));
  }
  // The cork board on posts at the back, the labels over the trays on it.
  for (const sx of [-1, 1]) parts.add(mesh(new THREE.BoxGeometry(0.05, 0.9, 0.05), woodDark, sx * (W / 2 - 0.06), H + 0.45, -D / 2 + 0.06));
  parts.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.62, 0.04), toon('#c9a26b'), 0, H + 0.58, -D / 2 + 0.06));
  const group = new THREE.Group();
  group.add(mergeByMaterial(parts));
  // Its words in the viewer's language, painted again on a switch (phrasePlane).
  const sign = phrasePlane('tickets.sign', { size: 40, bg: '#fffaf3' });
  sign.position.set(0, H + 1.12, -D / 2 + 0.1);
  group.add(sign);
  const labels: Record<TrayName, TextKey> = { review: 'tickets.tray.review', waiting: 'tickets.tray.waiting' };
  const trays = {} as Record<TrayName, THREE.Group>;
  for (const name of Object.keys(TRAYS) as TrayName[]) {
    const label = phrasePlane(labels[name], { size: 26, bg: name === 'waiting' ? '#ffd6a5' : '#caf0f8' });
    label.position.set(TRAYS[name] * 1.3, H + 0.6, -D / 2 + 0.09);
    group.add(label);
    const tray = trayModel();
    tray.scale.setScalar(1.6);
    tray.position.set(TRAYS[name] * 1.3, H, 0.02);
    group.add(tray);
    trays[name] = tray;
  }
  // The lamp by the owner's tray: lit and pulsing while anything waits on them.
  const lampMat = toonUnique('#adb5bd');
  const lamp = new THREE.Group();
  lamp.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 12), woodDark, 0, 0.02, 0, false));
  const bulb = mesh(new THREE.SphereGeometry(0.075, 14, 10), lampMat, 0, 0.11, 0, false);
  lamp.add(bulb);
  lamp.position.set(W / 2 - 0.12, H, 0.15);
  group.add(lamp);
  const counts = {} as Record<TrayName, THREE.Mesh | null>;

  // Built facing +z; it stands with its back to the meeting room's glass, facing the lounge (-z).
  group.position.set(x, 0, z);
  group.rotation.y = Math.PI;
  const collider: Collider = { minX: x - W / 2, maxX: x + W / 2, minZ: z - D / 2, maxZ: z + D / 2, top: H };
  const interactable: Interactable = { kind: 'review', x, z: z - D / 2 - 0.9, radius: 1.5 };
  group.userData.interact = interactable;
  let waiting = 0;
  const show = (on: boolean) => {
    group.visible = on;
    interactable.off = !on;
    const i = colliders.indexOf(collider);
    if (on && i < 0) colliders.push(collider);
    else if (!on && i >= 0) colliders.splice(i, 1);
  };
  show(false);
  const count = (name: TrayName, n: number) => {
    const had = counts[name];
    if (had) {
      group.remove(had);
      had.geometry.dispose();
      (had.material as THREE.MeshBasicMaterial).map?.dispose();
      (had.material as THREE.Material).dispose();
      counts[name] = null;
    }
    if (n <= STACK_SHOWN) return;
    const c = textPlane(`+${n - STACK_SHOWN}`, { size: 24, bg: '#2b2d42', color: '#fff' });
    c.position.set(TRAYS[name] * 1.3 + 0.32, H + 0.12, 0.2);
    group.add(c);
    counts[name] = c;
  };
  const table: ReviewTable = {
    group,
    setShown: show,
    shown: () => group.visible,
    setTrays(review, w) {
      stack(trays.review, review);
      stack(trays.waiting, Array.from({ length: w }, (): HandoffKind => 'handoff'));
      count('review', review.length);
      count('waiting', w);
      waiting = w;
    },
    trayTop(name) {
      const tray = trays[name];
      const n = Math.min(STACK_SHOWN, tray.children.filter((c) => c.userData.folder).length);
      group.updateMatrixWorld(true);
      return tray.localToWorld(new THREE.Vector3(0, 0.03 + n * STACK_STEP, 0));
    },
    front: { x, z: z - D / 2 - 0.85, rotY: 0 },
    update(_dt, t) {
      if (!group.visible) return;
      const glow = waiting ? 0.55 + 0.45 * Math.sin(t * 4) : 0;
      lampMat.color.set(waiting ? '#ff9f1c' : '#adb5bd');
      lampMat.emissive.setRGB(glow, glow * 0.45, 0);
      bulb.scale.setScalar(waiting ? 1 + 0.12 * Math.max(0, Math.sin(t * 4)) : 1);
    },
  };
  return { table, interactable };
}

/** The review table, east of the meeting room's door; put away until the floor turns out to keep tickets. */
export const reviewTable: Fixture<'review'> = (site) => {
  const { table, interactable } = buildReviewTable(site.colliders);
  return { group: table.group, interactables: [interactable], update: (t, dt) => table.update(dt, t), handle: { review: table } };
};
