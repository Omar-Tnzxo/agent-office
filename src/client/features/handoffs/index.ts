/**
 * Handoffs: on a floor whose repository keeps its work as tickets (see server/tickets/), the
 * visitors hand the work to each other the way people in an office would. When a ticket's chain log
 * gets a new row, its giver gets up with a folder, walks over to whoever takes it next (or, for a
 * review with nobody there to take it, to the review table), says a few words and hands it over,
 * then goes back to where it belongs. Each seated visitor has an in-tray with a folder per ticket
 * waiting on its role, and the review table by the meeting room holds what's in review and what
 * waits on the owner, with E there to read it all. Only to look at: nothing here writes a ticket.
 */
import * as THREE from 'three';
import type { Handoff } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { noOutline } from '../../core/outline';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { Errand, dropInto, type Destination, type Flight } from './errand';
import { HandoffQueue, trayFor, visitorFor } from './plan';
import { Trays } from './trays';
import { openReview } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    review: true;
  }
}

export type HandoffParts = Pick<Parts, 'visitors'>;

/** Seconds between one look at who sits where (for the in-trays) and the next. */
const TRAYS_EVERY = 0.5;

/** Follows the floor's tickets (the 'tickets' topic) and its handoffs (the 'tickets.handoff' message), and acts them out each frame ('others'). */
export function installHandoffs(ctx: Ctx, parts: HandoffParts) {
  const group = new THREE.Group();
  ctx.scene.add(group);
  noOutline(group);
  const queue = new HandoffQueue();
  const trays = new Trays();
  let errands: Errand[] = [];
  let flights: Flight[] = [];
  let traysIn = 0;
  const lender = () => parts.visitors.errands;
  const table = () => ctx.office.review;
  const here = () => ctx.inOffice() && store.tickets.on;
  const busy = (role: string) => errands.some((e) => e.handoff.from === role || e.handoff.to === role);
  const now = () => performance.now() / 1000;

  function showReview() {
    if (!store.me.admin) return toast('Only admins can read the tickets at the review table');
    if (!store.floor) return toast('Take the elevator to a floor first');
    if (!store.tickets.on) return toast("This floor's repository keeps no tickets (work/<id>/ticket.md)");
    openReview({ floor: store.floor, project: store.project?.name });
  }

  /** The table out or away, and what's in its trays. */
  function arrange() {
    const on = here();
    table().setShown(on);
    if (!on) return;
    const s = store.tickets;
    table().setTrays(
      s.tickets.filter((t) => t.review).map(() => 'review' as const),
      s.approvals.length,
    );
  }
  store.on('tickets', arrange);
  store.on('map', arrange);
  ctx.messages.on('welcome', () => arrange());
  ctx.messages.on('floor.enter', () => arrange());

  /** Everything under way stops: another floor, another map. Givers are put where they're to be at once. */
  function stopAll() {
    for (const e of errands) e.finish(true);
    errands = [];
    for (const f of flights) f.folder.removeFromParent();
    flights = [];
    queue.clear();
    trays.clear();
  }
  ctx.messages.on('welcome', stopAll, 'before');
  ctx.messages.on('floor.enter', stopAll, 'before');
  store.on('map', stopAll);

  ctx.messages.on('tickets.handoff', (msg) => {
    if (here()) queue.push(msg.handoff, now());
  });

  /** Acts a handoff out, if anyone's here to: false when its giver can't set off just yet. */
  function begin(h: Handoff): boolean {
    const visitors = store.visitors.visitors;
    const { roles } = store.tickets;
    const lend = lender();
    const giver = visitorFor(h.from, visitors, roles);
    const taker = visitorFor(h.to, visitors, roles);
    const takerHere = taker && taker.id !== giver?.id && lend.where(taker.id) ? taker : undefined;
    let to: Destination | null = null;
    if (takerHere) to = { kind: 'visitor', id: takerHere.id };
    else if (h.kind === 'review' && table().shown()) to = { kind: 'table', tray: 'review', top: () => table().trayTop('review'), front: table().front };
    if (giver && lend.where(giver.id) && to) {
      // Half way through a hop, or not out of the elevator yet: it goes once it can, and nothing's made till then.
      if (!lend.canLend(giver.id)) return false;
      const e = new Errand(h, giver.id, to, { lender: lend, nav: ctx.world().nav, group, trayTop: (id) => trays.top(id), footstep: (x, y, z) => ctx.sound.stepAt(x, z, y) });
      const how = e.start();
      if (how === 'wait') return false;
      if (how === 'started') errands.push(e);
      return true;
    }
    // Its giver isn't on the floor: the folder just lands in its taker's tray.
    const top = takerHere ? trays.top(takerHere.id) : null;
    if (top) flights.push(dropInto(top, h, group));
    return true;
  }

  ctx.ticks.add('others', ({ dt }) => {
    group.visible = ctx.inOffice();
    if (!here()) {
      if (errands.length || flights.length || queue.size) stopAll();
      return;
    }
    errands = errands.filter((e) => e.step(dt));
    flights = flights.filter((f) => f.step(dt) || void f.folder.removeFromParent());
    const next = queue.next(now(), busy);
    if (next && !begin(next.h)) queue.putBack(next.h, next.got);
    traysIn -= dt;
    if (traysIn <= 0) {
      traysIn = TRAYS_EVERY;
      const { tickets, roles } = store.tickets;
      trays.sync(lender().seated(), (id) => {
        const v = store.visitors.visitors.find((x) => x.id === id);
        return v ? trayFor(v, tickets, roles).map((tk) => (tk.review ? 'review' : 'handoff')) : [];
      });
    }
  });

  ctx.interactions.define('review', {
    reach: 4,
    hint: () => {
      const s = store.tickets;
      const review = s.tickets.filter((t) => t.review).length;
      const waiting = s.approvals.length;
      const admin = store.me.admin;
      return { k: `${review}|${waiting}|${admin}`, parts: [hintTitle('🗂️ Review table'), aside(`${review} in review · ${waiting} waiting for you${admin ? '' : ' · for admins'}`), ...(admin ? [key('E', 'Look through it')] : [])] };
    },
    use: onE(() => {
      if (store.me.admin) showReview();
    }),
  });

  return { showReview };
}
