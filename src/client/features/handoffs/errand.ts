import * as THREE from 'three';
import { deskPoint, type NavGrid, type Pt } from '../../../shared/nav';
import type { Handoff } from '../../../shared/protocol';
import type { Worker } from '../../world/character';
import type { DeskView } from '../../world/types';
import { stepWalk, walkAlong, type Walk } from '../visitors/walk';
import { folderModel } from './folder';
import type { TrayName } from './world';

// One handoff acted out: the giver gets up with the ticket's folder under its arm, walks over to
// whoever takes it next (beside their chair, or up to them where they stand) or, with nobody there to
// take a review, to the review table, and the two face each other while it says its few words and
// hands the folder over. Then it's given back to the visitors, who walk it on to its desk or its spot.

/** Seconds of the hand-over: the folder goes across from `FLY_AT`, for `FLY` seconds; the taker answers at `REPLY_AT`. */
const GIVE = 2.4;
const FLY_AT = 0.8;
const FLY = 0.55;
const REPLY_AT = 0.6;
/** Seconds for the folder to come out at the start. */
const PICK_UP = 0.35;
/** How far from someone standing the giver stops. */
const STAND_OFF = 1.0;
/** How far a seated taker turns round in its chair to face the giver, at most. */
const TURN_MOST = 1.2;

/** What a visitor errand needs of the visitors (see errands in features/visitors). */
export interface Lender {
  canLend(id: string): boolean;
  where(id: string): { x: number; z: number; desk: DeskView | null; model: Worker } | undefined;
  lend(id: string): { model: Worker; seat: DeskView['def'] | null; down: Walk['down'] } | undefined;
  giveBack(id: string, atOnce?: boolean): void;
  refresh(id: string): void;
}

/** Where the folder ends up: in a seated taker's tray, in a standing one's hands, or in one of the review table's trays. */
export type Destination = { kind: 'visitor'; id: string } | { kind: 'table'; tray: TrayName; top: () => THREE.Vector3; front: { x: number; z: number } };

export interface ErrandDeps {
  lender: Lender;
  nav: NavGrid;
  /** What flying folders go in (the room's own space). */
  group: THREE.Object3D;
  /** The top of a seated visitor's in-tray, if it has one. */
  trayTop(visitor: string): THREE.Vector3 | null;
  footstep(x: number, y: number, z: number): void;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (k: number) => k * k * (3 - 2 * k);

/** Says `text` over `model`'s head, a little higher than Worker.say puts it, clear of the name tag under it. */
function sayAbove(model: Worker, text: string, lift: number) {
  model.say(text);
  // Worker.say adds its bubble last.
  const bubble = model.root.children[model.root.children.length - 1];
  if (bubble instanceof THREE.Sprite) bubble.position.y += lift;
}

/** What the taker says back. */
function reply(h: Handoff): string {
  return h.kind === 'return' ? 'On it' : h.kind === 'review' ? "I'll take a look" : 'Thanks!';
}

/** A folder flying from one spot to another in a little arc, gone once it's there. */
export class Flight {
  t = 0;
  constructor(
    readonly folder: THREE.Object3D,
    private from: THREE.Vector3,
    private to: () => THREE.Vector3,
    private time: number,
    private arc = 0.35,
  ) {}

  /** False once it's landed. */
  step(dt: number): boolean {
    this.t = Math.min(1, this.t + dt / this.time);
    const k = ease(this.t);
    const to = this.to();
    this.folder.position.lerpVectors(this.from, to, k);
    this.folder.position.y += Math.sin(k * Math.PI) * this.arc;
    this.folder.rotation.x = (1 - k) * -1.1;
    return this.t < 1;
  }
}

export class Errand {
  private model: Worker | null = null;
  private walk: Walk | null = null;
  private phase: 'walk' | 'give' | 'done' = 'walk';
  private t = 0;
  /** Made once it sets off (see start). */
  private folder = new THREE.Group();
  private flight: Flight | null = null;
  private replied = false;
  /**
   * A seated taker turned round to face the giver: its model, how far, and the seat it was in then.
   * It's only turned (and turned back) while it's still in that seat: one that got up meanwhile is the visitors' again.
   */
  private turned: { model: Worker; by: number; seat: THREE.Object3D } | null = null;

  constructor(
    readonly handoff: Handoff,
    readonly giver: string,
    private to: Destination,
    private deps: ErrandDeps,
  ) {}

  /** Lends the giver out and sets it off: 'wait' when it can't go just now (half way through a hop), 'gone' when its taker has left. */
  start(): 'started' | 'wait' | 'gone' {
    const { lender, nav } = this.deps;
    const target = this.target();
    if (!target) return 'gone';
    const lent = lender.lend(this.giver);
    if (!lent) return 'wait';
    this.model = lent.model;
    const { root } = lent.model;
    const from: Pt = [root.position.x, root.position.z];
    let way: Pt[];
    if (lent.seat) {
      const out = nav.wayFrom(lent.seat, target.desk ? deskPoint(target.desk.def, 0, 1.75) : target.at);
      way = target.desk ? [out[0], ...nav.wayTo(out[1], target.desk.def)] : [...out, target.at];
    } else way = target.desk ? [from, ...nav.wayTo(from, target.desk.def)] : [...nav.route(from, target.at), target.at];
    const end = way[way.length - 1];
    const face = Math.atan2(target.look[0] - end[0], target.look[1] - end[1]);
    this.walk = walkAlong(way, null, face, root.rotation.y, 0, lent.down);
    // Under its arm, held up in front of it.
    this.folder = folderModel(this.handoff.kind);
    this.folder.position.set(0, 0.5, 0.3);
    this.folder.rotation.set(-1.1, 0, 0);
    this.folder.scale.setScalar(0.001);
    root.add(this.folder);
    return 'started';
  }

  /** Where the giver walks to, and what it turns to face there: a seated taker's chair, a standing one, or the review table. */
  private target(): { desk: DeskView | null; at: Pt; look: Pt } | undefined {
    if (this.to.kind === 'table') return { desk: null, at: [this.to.front.x, this.to.front.z], look: [this.to.front.x, this.to.front.z + 2] };
    const there = this.deps.lender.where(this.to.id);
    if (!there) return undefined;
    if (there.desk) return { desk: there.desk, at: [there.x, there.z], look: [there.x, there.z] };
    const me = this.deps.lender.where(this.giver);
    const dx = (me?.x ?? there.x + 1) - there.x;
    const dz = (me?.z ?? there.z) - there.z;
    const d = Math.hypot(dx, dz) || 1;
    const at = this.deps.nav.nearestWalkable([there.x + (dx / d) * STAND_OFF, there.z + (dz / d) * STAND_OFF]);
    return { desk: null, at, look: [there.x, there.z] };
  }

  /** False once it's over (the giver handed back to the visitors). */
  step(dt: number): boolean {
    const model = this.model;
    if (!model || this.phase === 'done') return false;
    if (!this.deps.lender.where(this.giver)) {
      this.finish(true);
      return false;
    }
    this.t += dt;
    if (this.folder.parent === model.root) this.folder.scale.setScalar(Math.min(1, this.t / PICK_UP) * 1.25);
    if (this.phase === 'walk') {
      if (stepWalk(model, this.walk!, dt, this.deps.footstep)) return true;
      this.phase = 'give';
      this.t = 0;
      sayAbove(model, this.handoff.say, 0.3);
      return true;
    }
    // Face to face, the folder going across.
    const taker = this.to.kind === 'visitor' ? this.deps.lender.where(this.to.id) : undefined;
    if (taker && !this.replied && this.t >= REPLY_AT) {
      this.replied = true;
      sayAbove(taker.model, reply(this.handoff), 0.75);
      if (taker.desk && taker.model.root.parent === taker.desk.seatAnchor) {
        const anchorYaw = taker.desk.def.rotY + Math.PI;
        const want = Math.atan2(model.root.position.x - taker.x, model.root.position.z - taker.z);
        this.turned = { model: taker.model, by: Math.max(-TURN_MOST, Math.min(TURN_MOST, wrap(want - anchorYaw))), seat: taker.desk.seatAnchor };
      }
    }
    if (this.turned && this.turned.model.root.parent === this.turned.seat) {
      // Round in its chair to face the giver, and back again at the end.
      const k = this.t < GIVE - 0.4 ? Math.min(1, this.t / 0.3) : Math.max(0, (GIVE - this.t) / 0.4);
      this.turned.model.root.rotation.y = this.turned.by * k;
    }
    if (!this.flight && this.t >= FLY_AT) this.throwFolder(taker);
    if (this.flight && !this.flight.step(dt)) {
      this.flight.folder.removeFromParent();
      this.flight = null;
    }
    if (this.t < GIVE) return true;
    this.finish(false);
    return false;
  }

  /** Out of the giver's hands and across: into a seated taker's tray, a standing one's hands, or the table's tray. */
  private throwFolder(taker: ReturnType<Lender['where']>) {
    const from = this.folder.getWorldPosition(new THREE.Vector3());
    this.folder.removeFromParent();
    this.folder.scale.setScalar(1.25);
    this.folder.position.copy(from);
    this.deps.group.add(this.folder);
    let to: () => THREE.Vector3;
    if (this.to.kind === 'table') to = this.to.top;
    else {
      const id = this.to.id;
      const tray = this.deps.trayTop(id);
      const hands = taker ? new THREE.Vector3(taker.x, (taker.desk ? 0.4 : 0) + 0.5, taker.z) : from.clone();
      to = () => tray ?? hands;
    }
    this.flight = new Flight(this.folder, from, to, FLY);
  }

  /** Over: the folder away, the taker turned back to its desk, the giver back to the visitors. `atOnce`: it's somewhere else now (another floor). */
  finish(atOnce: boolean) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.folder.removeFromParent();
    this.flight = null;
    if (this.turned && this.turned.model.root.parent === this.turned.seat) this.turned.model.root.rotation.y = 0;
    if (this.model) this.deps.lender.giveBack(this.giver, atOnce);
    if (this.to.kind === 'visitor') this.deps.lender.refresh(this.to.id);
  }
}

/** A folder dropping into a seated visitor's tray from above, for a handoff whose giver isn't on the floor. */
export function dropInto(top: THREE.Vector3, h: Handoff, group: THREE.Object3D): Flight {
  const folder = folderModel(h.kind);
  folder.scale.setScalar(1.25);
  group.add(folder);
  return new Flight(folder, top.clone().add(new THREE.Vector3(0, 1.1, 0)), () => top, 0.6, 0);
}
