// Who is who among a floor's visitors, which tickets wait in whose tray, and which handoff runs
// next. No three.js, so tests/handoffs.test.ts runs it as it is.
import type { Handoff, TicketSummary, Visitor } from '../../../shared/protocol';
import { roleKey } from '../../../shared/tickets';

/** The names a role goes by: its slug, and the name on its card (roles/<slug>.md), as roleKey has them. */
function keysOf(role: string, roles: Readonly<Record<string, string>>): Set<string> {
  const keys = new Set([roleKey(role)]);
  if (roles[role]) keys.add(roleKey(roles[role]));
  return keys;
}

/** Whether a visitor is the session of `role`: it goes by that role's name (see roleOf in server/visitors/transcript.ts). */
export function isRole(v: Pick<Visitor, 'title'>, role: string, roles: Readonly<Record<string, string>>): boolean {
  return keysOf(role, roles).has(roleKey(v.title));
}

/**
 * The visitor that is `role` on this floor: of the ones that go by its name (none of another
 * repository, in the lobby), one still at work before one that's done, then the one heard from last.
 */
export function visitorFor<V extends Pick<Visitor, 'id' | 'title' | 'status' | 'seenAt' | 'lobby'>>(role: string, visitors: readonly V[], roles: Readonly<Record<string, string>>): V | undefined {
  return visitors
    .filter((v) => !v.lobby && isRole(v, role, roles))
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.seenAt - a.seenAt)[0];
}

/** The open tickets waiting on a visitor's role: the ones whose next role it is, the most recently written first. */
export function trayFor(v: Pick<Visitor, 'title'>, tickets: readonly TicketSummary[], roles: Readonly<Record<string, string>>): TicketSummary[] {
  return tickets.filter((t) => t.next && isRole(v, t.next, roles));
}

/**
 * The handoffs waiting to be acted out, oldest first. Each giver hands on one at a time, so the next
 * is the oldest whose giver and taker are both free; one that has waited longer than `maxAge`
 * seconds is dropped instead of played late, and so are the oldest past `max`.
 */
export class HandoffQueue {
  private waiting: { h: Handoff; got: number }[] = [];

  constructor(
    private maxAge = 120,
    private max = 12,
  ) {}

  get size(): number {
    return this.waiting.length;
  }

  push(h: Handoff, now: number) {
    this.waiting.push({ h, got: now });
    if (this.waiting.length > this.max) this.waiting.splice(0, this.waiting.length - this.max);
  }

  /** Puts one taken off back at the front of the line, as old as it was (its giver couldn't go just then). */
  putBack(h: Handoff, got: number) {
    this.waiting.unshift({ h, got });
  }

  /** The next to act out, taken off the queue, with when it came, or none yet. `busy`: a role that's out on an errand already. */
  next(now: number, busy: (role: string) => boolean): { h: Handoff; got: number } | undefined {
    this.waiting = this.waiting.filter((w) => now - w.got <= this.maxAge);
    const taken = new Set<string>();
    for (let i = 0; i < this.waiting.length; i++) {
      const { h } = this.waiting[i];
      // One that's earlier in line holds its giver: its handoffs go in order.
      const free = !busy(h.from) && !busy(h.to) && !taken.has(h.from) && !taken.has(h.to);
      taken.add(h.from);
      taken.add(h.to);
      if (!free) continue;
      return this.waiting.splice(i, 1)[0];
    }
    return undefined;
  }

  clear() {
    this.waiting = [];
  }
}
