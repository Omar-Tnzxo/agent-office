/**
 * Visitors: Claude Code sessions the office didn't start (the Claude desktop app, a terminal, an
 * IDE), on the floor whose repository they work in (or on the building's first floor, its lobby,
 * when no floor's is theirs), each with a card saying what it's called and what it's on, and its
 * subagents round it. One at work on the floor's own repository walks from the elevator to a desk no
 * worker has and sits there typing, and walks back to its spot by the elevator once its turn is over;
 * the rest stand in the lobby. Only to look at: nothing here can drive them, a worker hired at a
 * visitor's desk gets it, and the office never writes to their files (see server/visitors/).
 */
import * as THREE from 'three';
import { deskPoint, type Pt } from '../../../shared/nav';
import type { Visitor, VisitorApp } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { seatBuilt } from '../../core/floors';
import { aside, hintTitle, key } from '../../core/hint';
import type { Parts } from '../../core/parts';
import { canWatch } from '../visitor-watch';
import { laptopScreen, showOnLaptop } from '../visitor-watch/screen';
import { noOutline } from '../../core/outline';
import { labels, ltrText, onLang, t, tn } from '../../i18n';
import { store } from '../../state';
import { SubagentCrowd, Worker, subagentColor } from '../../world/character';
import type { DeskView, Interactable } from '../../world/types';
import { SHOWN as CHAIR_SHOWN, SIZE as CHAIR_SIZE, spot as chairSpot } from '../subagents';
import { Laptop } from '../workers/laptop';
import { assignDesks, assignSpots, inPlace, visitorDesks, wantsDesk } from './seats';
import { VISITOR_SPOTS, subagentSpot } from './spots';
import { FEET, SPACING, stepWalk, walkAlong, type Walk } from './walk';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    visitor: true;
  }
}

/** How big a visitor's subagents are, next to it, in the lobby. */
const SUBAGENT_SIZE = 0.5;
/** How close (meters) you stop a visitor jumping, and how far you go before it starts again: a worker's (see features/workers/views.ts). */
const HOLD_NEAR = 4;
const HOLD_LEAVE = 5;
/** Seconds for a shut laptop to shrink away. */
const LAPTOP_GONE = 0.3;
const NOBODY: readonly Interactable[] = [];

const APP = labels<VisitorApp>({
  desktop: 'desks.visitor.app.desktop',
  cli: 'desks.visitor.app.cli',
  ide: 'desks.visitor.app.ide',
  other: 'desks.visitor.app.other',
});

interface VisitorView {
  id: string;
  model: Worker;
  status: string;
  /** Its own lobby spot, of VISITOR_SPOTS, and the one it's standing at now (null: it isn't standing). */
  spot: number;
  standsAt: number | null;
  /** The desk it's to sit at (it's there, or on its way), or none: its lobby spot. */
  goal: string | undefined;
  /** The desk it's sitting at. */
  desk: DeskView | null;
  /** On its way to its desk or its spot. */
  walk: Walk | null;
  /** Its laptop, once it has sat down somewhere: open on its desk while it sits there, shut and put away when it gets up. */
  laptop: Laptop | null;
  /** Where its subagents stand: on the floor under its seat, or at its lobby spot. */
  ring: THREE.Object3D;
  crowd: SubagentCrowd | null;
  /** Where to aim at it, kept up with it (see usables below). */
  it: Interactable;
}

/** What a visitor's card says: its title, and where it is and what it's doing. */
export function visitorCard(v: Visitor): { name: string; summary: string } {
  const where = `${v.lobby ? '🛎️ ' : ''}${v.folder}${v.branch ? ` (${v.branch})` : ''}`;
  return { name: v.title, summary: v.activity ? `${where} · ${v.activity}` : where };
}

/** Follows the floor's visitors (the 'visitors' topic) and whatever moves them (the workers, the floor's plan, the map), and their tick ('others'). */
export function installVisitors(ctx: Ctx, parts: Pick<Parts, 'visitorWatch'>) {
  const { sound, player, camera } = ctx;
  const views = new Map<string, VisitorView>();
  const group = new THREE.Group();
  ctx.scene.add(group);
  noOutline(group);
  /** The desk each visitor has, and its lobby spot, as last worked out (see seats.ts). */
  let desks = new Map<string, string>();
  let spots = new Map<string, number>();
  /** Laptops of visitors who got up, shutting. */
  let closing: { laptop: Laptop; gone: number }[] = [];
  /** Set while a floor arrives (a welcome, a floor.enter): its visitors are where they're going already, nobody walks. */
  let arriving = false;
  /** When (performance.now(), in seconds) the next visitor may step out of the elevator: they come one at a time. */
  let nextOutAt = 0;
  /**
   * Whether the '+' over a seated visitor's desk is put away. A worker can be hired there all the same
   * (the desk's own prompt), so it is only while some other desk still shows one: with a visitor at
   * every free desk, theirs stay up, and there's always a '+' to say where the next worker goes.
   */
  let plusHidden = false;
  /** Whom you can walk up to (see usables below), and where the ones walking are, for the elevator's doors. */
  let nearby: Interactable[] = [];
  const walkers: THREE.Vector3[] = [];
  const at = new THREE.Vector3();
  const size = new THREE.Vector3();
  const footstep = (x: number, y: number, z: number) => sound.stepAt(x, z, y);
  const listed = () => store.visitors.visitors.slice(0, VISITOR_SPOTS.length);
  /** Visitors lent out for an errand (see errands below): nothing here moves them, or redraws their card, until they're given back. */
  const lent = new Set<string>();

  /** Off the desk it was on, shut, till its visitor sits down again: it keeps the one for as long as it's listed. */
  function putAway(laptop: Laptop) {
    closing = closing.filter((c) => c.laptop !== laptop);
    laptop.shut(1);
    laptop.root.removeFromParent();
    laptop.root.scale.setScalar(1);
  }

  /** Off its chair or its spot, or off its way: nothing of it is left there. `atOnce`: its laptop goes without shutting first. */
  function leave(view: VisitorView, atOnce: boolean) {
    view.walk = null;
    view.model.walking = false;
    view.model.root.visible = true;
    view.standsAt = null;
    // Up and about: aimed at itself again (see sit).
    view.model.root.userData.interact = view.it;
    view.crowd?.dispose();
    view.crowd = null;
    if (view.desk) {
      if (view.laptop && atOnce) putAway(view.laptop);
      else if (view.laptop) closing.push({ laptop: view.laptop, gone: 0 });
      sound.removeTypist(view.id);
      // Its '+' again, unless a worker has the desk now (see plusHidden).
      view.desk.vacancy.visible = !store.workerAtDesk(view.desk.def.id) && seatBuilt(view.desk.def.id);
    }
    view.desk = null;
  }

  /** Standing at its lobby spot, facing the room, its subagents round it. */
  function stand(view: VisitorView) {
    const [x, z, rotY] = VISITOR_SPOTS[view.spot];
    const { root } = view.model;
    group.add(root, view.ring);
    root.position.set(x, -FEET, z);
    root.rotation.set(0, rotY, 0);
    root.scale.setScalar(1);
    view.ring.position.set(x, 0, z);
    view.ring.rotation.y = rotY;
    view.crowd = new SubagentCrowd(view.ring, subagentSpot, SUBAGENT_SIZE);
    view.standsAt = view.spot;
    root.userData.interact = view.it;
    view.it.x = x;
    view.it.z = z;
  }

  /** In the chair at `desk`, the way a worker sits there, with a laptop open in front of it and its subagents behind its chair. */
  function sit(view: VisitorView, desk: DeskView) {
    const { root } = view.model;
    desk.seatAnchor.add(root);
    // Aimed at in its chair, it's the desk you aim at: its own prompt, a worker to hire there.
    delete root.userData.interact;
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    desk.chair.rotation.y = 0;
    if (!view.laptop) {
      view.laptop = new Laptop(ctx.world().device);
      noOutline(view.laptop.root);
    } else putAway(view.laptop);
    desk.laptopAnchor.add(view.laptop.root);
    // On the floor under the seat, turned the way it faces (see features/subagents).
    view.ring.position.set(desk.seatAnchor.position.x, 0, desk.seatAnchor.position.z);
    view.ring.rotation.y = desk.seatAnchor.rotation.y;
    desk.group.add(view.ring);
    view.crowd = new SubagentCrowd(view.ring, chairSpot, CHAIR_SIZE);
    view.desk = desk;
    desk.seatAnchor.getWorldPosition(at);
    view.it.x = at.x;
    view.it.z = at.z;
  }

  /** The desk `view` is to sit at, if it's there to sit at. */
  const goalDesk = (view: VisitorView) => (view.goal ? ctx.world().desks.get(view.goal) : undefined);
  /** Whether it's where it's to be: in its chair, or at its own spot (see inPlace). */
  const settled = (view: VisitorView) => inPlace({ walking: !!view.walk, goal: view.goal, desk: view.desk?.def.id, spot: view.spot, standsAt: view.standsAt });

  /** There at once, wherever it was: nobody watched it go. */
  function place(view: VisitorView) {
    if (settled(view)) return;
    leave(view, true);
    const desk = goalDesk(view);
    if (desk) sit(view, desk);
    else stand(view);
  }

  /** Sets off for where it's to be, from wherever it is: its chair, its spot, or part way to somewhere else. */
  function setOff(view: VisitorView) {
    // Half way up onto a chair: it lands first, and sets off from there, sitting only if the chair is still its own (see the tick).
    if (view.walk?.up) return;
    const { nav } = ctx.world();
    const { root } = view.model;
    const desk = goalDesk(view) ?? null;
    const [sx, sz, rotY] = VISITOR_SPOTS[view.spot];
    const face = desk ? desk.def.rotY + Math.PI : rotY;
    /** From `from` to beside the chair, or to its spot (which may be a step off where the grid lets it walk). */
    const wayTo = (from: Pt): Pt[] => (desk ? nav.wayTo(from, desk.def) : [...nav.route(from, [sx, sz]), [sx, sz]]);
    const was = view.walk;
    if (view.desk) {
      // Up out of its chair: down beside it on the shorter side, and off.
      const from = view.desk;
      const seat = root.getWorldPosition(new THREE.Vector3());
      const scale = root.getWorldScale(size).x;
      // A worker hired in its chair has a laptop of its own there already: the visitor's goes at once.
      leave(view, !!store.workerAtDesk(from.def.id));
      group.add(root);
      root.position.copy(seat);
      root.rotation.set(0, from.def.rotY + Math.PI, 0);
      root.scale.setScalar(scale);
      const out = nav.wayFrom(from.def, desk ? deskPoint(desk.def, 0, 1.75) : [sx, sz]);
      const way = desk ? [out[0], ...nav.wayTo(out[1], desk.def)] : [...out, [sx, sz] as Pt];
      view.walk = walkAlong(way, desk, face, root.rotation.y, 0, { from: seat, scale, p: 0 });
    } else if (was) {
      // On its way already: from where it is, or from where it lands or steps out.
      const from: Pt = was.down || was.wait > 0 ? was.way[0] : [root.position.x, root.position.z];
      view.walk = walkAlong(wayTo(from), desk, face, was.heading, was.wait, was.down);
    } else {
      leave(view, false);
      view.walk = walkAlong(wayTo([root.position.x, root.position.z]), desk, face, root.rotation.y);
    }
  }

  /** A visitor that has only just turned up, at work: out of the elevator and over to its desk, after whoever stepped out last. */
  function walkIn(view: VisitorView, desk: DeskView) {
    const now = performance.now() / 1000;
    const wait = Math.max(0, nextOutAt - now);
    nextOutAt = now + wait + SPACING;
    const way = ctx.world().ways.in(desk.def);
    const { root } = view.model;
    group.add(root);
    root.position.set(way[0][0], -FEET, way[0][1]);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
    root.visible = wait <= 0;
    view.walk = walkAlong(way, desk, desk.def.rotY + Math.PI, 0, wait);
  }

  /** Its card, its light and its subagents, as the office last read them. */
  function show(view: VisitorView, v: Visitor) {
    if (view.status !== v.status) {
      view.status = v.status;
      // Waiting on you in its own app: it hops, the way a worker that needs you does.
      view.model.setStatus(v.status, v.status === 'needs_input');
    }
    view.model.setTask(visitorCard(v));
    const desk = view.desk;
    // At a desk they stand the way a worker's do, past CHAIR_SHOWN a count; in the lobby, all the office was told of.
    const shown = desk ? v.subagents.slice(0, CHAIR_SHOWN) : v.subagents;
    view.crowd?.sync(shown, v.subagentCount - shown.length);
    if (!desk) return;
    // What it's doing, as its screen would show it (see visitor-watch/screen.ts).
    if (view.laptop) showOnLaptop(view.laptop, v);
    // Keys clack while it's at work, as they do under a worker.
    sound.setTyping(view.id, desk.def.x, desk.def.z, v.status === 'working');
  }

  function drop(id: string) {
    const view = views.get(id);
    if (!view) return;
    lent.delete(id);
    leave(view, true);
    if (view.laptop) {
      putAway(view.laptop);
      view.laptop.dispose();
    }
    view.model.root.removeFromParent();
    view.ring.removeFromParent();
    view.model.dispose();
    views.delete(id);
  }

  /**
   * Someone sat down, got up or set off. Whom you can walk up to: the ones standing or walking (one at
   * a desk is only aimed at, so that walking up to its desk is the desk's own prompt, as it is with
   * nobody there). And the '+' over the desks they sit at: away while a desk with nobody at it shows one.
   */
  function whoIsWhere() {
    nearby = [];
    for (const view of views.values()) if (!view.desk && !(view.walk && view.walk.wait > 0)) nearby.push(view.it);
    let free = 0;
    let seated = 0;
    if (ctx.inOffice()) for (const id of visitorDesks(store.floorPlan.wing)) if (!store.workerAtDesk(id)) free++;
    for (const view of views.values()) if (view.desk) seated++;
    plusHidden = free > seated;
    for (const view of views.values()) if (view.desk) view.desk.vacancy.visible = !plusHidden && !store.workerAtDesk(view.desk.def.id);
  }

  function sync() {
    const here = ctx.inOffice();
    group.visible = here;
    const list = listed();
    const ids = new Set(list.map((v) => v.id));
    for (const id of [...views.keys()]) if (!ids.has(id)) drop(id);
    // Only the office's own map has desks to walk to from here; workers come first, at every one of them.
    const free = here ? visitorDesks(store.floorPlan.wing).filter((id) => !store.workerAtDesk(id) && ctx.world().desks.has(id)) : [];
    desks = assignDesks(list, free, desks);
    spots = assignSpots(list.map((v) => v.id), spots, VISITOR_SPOTS.length);
    for (const v of list) {
      const goal = wantsDesk(v) ? desks.get(v.id) : undefined;
      let view = views.get(v.id);
      const isNew = !view;
      if (!view) {
        const model = new Worker(APP[v.app], subagentColor(v.id));
        const it: Interactable = { kind: 'visitor', x: 0, z: 0, radius: 0.6, seatId: v.id };
        // Aimed at while it stands or walks; in a chair, the desk is (see sit).
        model.root.userData.interact = it;
        noOutline(model.root);
        view = { id: v.id, model, status: '', spot: 0, standsAt: null, goal: undefined, desk: null, walk: null, laptop: null, ring: new THREE.Object3D(), crowd: null, it };
        views.set(v.id, view);
      }
      const spot = spots.get(v.id) ?? 0;
      // A new desk, or none and a new spot: it goes there.
      const moved = isNew || goal !== view.goal || (!goal && spot !== view.spot);
      view.goal = goal;
      view.spot = spot;
      // Out on an errand: it goes where it's to be once it's back (see errands).
      if (lent.has(v.id)) continue;
      // A desk walled up under it: there's no walking out of that.
      const walled = !!view.desk && !seatBuilt(view.desk.def.id);
      const desk = goalDesk(view);
      if (arriving || !here || walled || (isNew && !desk)) place(view);
      else if (isNew && desk) walkIn(view, desk);
      else if (moved) setOff(view);
      show(view, v);
    }
    whoIsWhere();
  }
  store.on('visitors', sync);
  // Their laptops' "waiting on you" (and the cards' bubbles) in the language now.
  onLang(sync);
  // A worker hired at a visitor's desk, or a row of the back office walled up: it finds another, or goes back to the lobby.
  store.on('workers', sync);
  store.on('floorPlan', sync);
  // Another map put up: whoever was at a desk of the last one is where it goes on this one, without a walk.
  store.on('map', () => {
    const was = arriving;
    arriving = true;
    sync();
    arriving = was;
  });
  ctx.messages.on('welcome', () => void (arriving = true), 'before');
  ctx.messages.on('floor.enter', () => void (arriving = true), 'before');
  // The office's first look after nobody was in it: they were at work already, so they're in their seats,
  // and in the ones they'd have on a page that had only just been loaded (what the last list said was
  // stale). Their lobby spots stay: the ones still listed are standing at them, and a newcomer takes a
  // free one, so nobody is put on top of anybody (see assignSpots).
  ctx.messages.on(
    'visitors',
    (msg) => {
      arriving = !!msg.caughtUp;
      if (arriving) desks = new Map();
    },
    'before',
  );
  // Once the store has it: whoever turns up or starts work from now on walks.
  ctx.messages.onAny(() => void (arriving = false));

  ctx.ticks.add('others', ({ dt, t }) => {
    walkers.length = 0;
    if (!group.visible) return;
    let changed = false;
    for (const view of views.values()) {
      const { model, it } = view;
      const w = view.walk;
      if (lent.has(view.id)) {
        it.x = model.root.position.x;
        it.z = model.root.position.z;
      }
      if (w) {
        const waiting = w.wait > 0;
        if (stepWalk(model, w, dt, footstep)) {
          it.x = model.root.position.x;
          it.z = model.root.position.z;
          if (w.wait <= 0) walkers.push(model.root.position);
          changed ||= waiting && w.wait <= 0;
        } else {
          // There: into its chair, or at its spot. Told to go elsewhere on the last hop, it sets off again.
          view.walk = null;
          const chair = w.to;
          if (chair && w.up && (chair.def.id !== view.goal || !seatBuilt(chair.def.id) || store.workerAtDesk(chair.def.id))) {
            // Its chair isn't its own any more (a worker was hired there, the row walled up, another desk
            // is its now): back down to the floor where it hopped up from, and on from there (setOff below).
            const { root } = model;
            view.walk = walkAlong([[w.up.from.x, w.up.from.z]], null, w.face, root.rotation.y, 0, { from: root.position.clone(), scale: root.scale.x, p: 0 });
          } else if (chair) sit(view, chair);
          else stand(view);
          if (!settled(view)) setOff(view);
          const v = store.visitors.visitors.find((x) => x.id === view.id);
          if (v) show(view, v);
          changed = true;
        }
      }
      // A jumping visitor holds still while you're near enough to read its card, as a worker does.
      const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
      model.held = d < (model.held ? HOLD_LEAVE : HOLD_NEAR);
      model.update(dt, t);
      view.crowd?.update(dt, t);
      // Whatever else arranges the seats shows a '+' wherever no worker sits (see arrangeSeats in features/workers/views.ts).
      if (plusHidden && view.desk) view.desk.vacancy.visible = false;
      if (view.laptop && view.desk) view.laptop.update(dt, laptopScreen(view.laptop), Math.hypot(view.desk.def.x - camera.position.x, view.desk.def.z - camera.position.z));
    }
    if (changed) whoIsWhere();
    if (closing.length) {
      closing = closing.filter((c) => {
        if (!c.laptop.shut(dt)) return true;
        c.gone = Math.min(1, c.gone + dt / LAPTOP_GONE);
        c.laptop.root.scale.setScalar(Math.max(0.001, 1 - c.gone * c.gone));
        if (c.gone < 1) return true;
        c.laptop.root.removeFromParent();
        c.laptop.root.scale.setScalar(1);
        return false;
      });
    }
  });

  // Aimed at, a visitor says who it is, and E (or I, see visitor-watch) watches it: it's someone else's session.
  ctx.usables.add({
    usable: () => (group.visible ? nearby : NOBODY),
    pickable: () => group,
  });
  ctx.interactions.define('visitor', {
    reach: 4,
    hint: (it) => {
      const v = store.visitors.visitors.find((x) => x.id === it.seatId);
      if (!v) return { k: 'visitor', parts: [hintTitle(t('desks.visitor.aVisitor'))] };
      const subs = v.subagentCount ? ` · ${tn('desks.visitor.subagents', v.subagentCount)}` : '';
      // Watching is for admins (see visitor-watch).
      const admin = canWatch();
      return { k: `visitor|${v.id}|${v.status}|${v.subagentCount}|${admin}`, parts: [hintTitle(`👋 ${v.title}`), aside(`${APP[v.app]} · ${ltrText(v.folder)}${subs}`), admin ? key('I', t('watch.key')) : ''] };
    },
    use: (it, k) => {
      if (k === 'E' && it.seatId && canWatch()) parts.visitorWatch.watch(it.seatId);
    },
  });

  /**
   * Lending a visitor out for an errand (features/handoffs walks one over to hand a ticket on): while
   * it's lent, sync and the tick leave it be, and given back it sets off for its desk or its spot from
   * wherever the errand left it, the way it would after any walk.
   */
  const errands = {
    /** Where a visitor on this floor is (in its chair, or on its feet), and its model, to say something. */
    where(id: string): { x: number; z: number; desk: DeskView | null; model: Worker } | undefined {
      const view = views.get(id);
      if (!view || !group.visible) return undefined;
      if (view.desk) return { x: view.it.x, z: view.it.z, desk: view.desk, model: view.model };
      const { position: p } = view.model.root;
      return { x: p.x, z: p.z, desk: null, model: view.model };
    },
    /** The desks visitors are sitting at, by visitor. */
    seated(): [string, DeskView][] {
      return [...views.values()].filter((v) => v.desk && !lent.has(v.id)).map((v) => [v.id, v.desk!]);
    },
    /** Its model to walk about, standing on the floor (getting down off its chair first: `down`, from `seat`); none while it's in the middle of a hop or not out yet. */
    /** Whether it can be lent right now (see lend): it's here, on its feet or in its chair, not half way through a hop. */
    canLend(id: string): boolean {
      const view = views.get(id);
      const w = view?.walk;
      return !!view && !lent.has(id) && group.visible && !w?.up && !w?.down && !(w && w.wait > 0);
    },
    lend(id: string): { model: Worker; seat: DeskView['def'] | null; down: Walk['down'] } | undefined {
      const view = views.get(id);
      if (!view || !errands.canLend(id)) return undefined;
      const { root } = view.model;
      let seat: DeskView['def'] | null = null;
      let down: Walk['down'] = null;
      if (view.desk) {
        const from = view.desk;
        const at = root.getWorldPosition(new THREE.Vector3());
        const scale = root.getWorldScale(size).x;
        leave(view, !!store.workerAtDesk(from.def.id));
        root.position.copy(at);
        root.rotation.set(0, from.def.rotY + Math.PI, 0);
        root.scale.setScalar(scale);
        seat = from.def;
        down = { from: at, scale, p: 0 };
      } else leave(view, false);
      group.add(root);
      lent.add(id);
      whoIsWhere();
      return { model: view.model, seat, down };
    },
    /** Back from its errand: off to where it's to be (there at once with `atOnce`), its card as it was. */
    giveBack(id: string, atOnce = false) {
      const view = views.get(id);
      if (!lent.delete(id) || !view) return;
      view.walk = null;
      view.model.walking = false;
      if (atOnce || !ctx.inOffice()) place(view);
      else setOff(view);
      const v = store.visitors.visitors.find((x) => x.id === id);
      if (v) show(view, v);
      whoIsWhere();
    },
    /** Puts its card back up, after something else said something over its head. */
    refresh(id: string) {
      const view = views.get(id);
      const v = store.visitors.visitors.find((x) => x.id === id);
      if (view && v && !lent.has(id)) view.model.setTask(visitorCard(v));
    },
  };

  return {
    /** Where each visitor on its way is, for the doors to open. */
    positions: (): readonly THREE.Vector3[] => walkers,
    /** The visitor sitting at `deskId`, if one is. */
    seatedAt: (deskId: string): string | undefined => [...views.values()].find((view) => view.desk?.def.id === deskId)?.id,
    errands,
  };
}
