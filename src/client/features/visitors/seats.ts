// Which desk a visitor sits at, and which lobby spot is its own: worked out afresh from who's there
// each time the visitors, the workers or the floor change, and sticky (what each had last time goes
// back in). No three.js, so tests/visitor-seats.test.ts runs it as it is.
import { builtDesks } from '../../../shared/layout';
import type { Visitor } from '../../../shared/protocol';

/** A visitor at work on this floor's own repository sits at a desk. One that's done, or one of another repository, stands in the lobby. */
export function wantsDesk(v: Pick<Visitor, 'status' | 'lobby'>): boolean {
  return !v.lobby && v.status !== 'done';
}

/**
 * The desks visitors take, first to last, on a floor built out `wing` rows: the order the office
 * itself hires in (nextFreeSeat: desk 1 first, the back office last) backwards, so the desks it hands
 * out next are the last ones a visitor sits at. Never a bean bag, a kiosk or a meeting chair.
 */
export function visitorDesks(wing: number): string[] {
  return builtDesks(wing)
    .map((d) => d.id)
    .reverse();
}

/**
 * The desk of each visitor that has one: where it sits while it wants one (wantsDesk), and the one it
 * goes back to while it doesn't. `free` is the desks no worker has, in the order visitors take them
 * (visitorDesks); `held` is what this said last time. A visitor keeps its desk for as long as the
 * desk stays free. One with none takes the first free desk nobody is coming back to, else the first
 * free one (whoever was coming back to it forgets it). Visitors go in the order they're listed, the
 * workers come first (a desk a worker took isn't in `free`), and one with no desk left has none here.
 */
export function assignDesks(visitors: readonly Pick<Visitor, 'id' | 'status' | 'lobby'>[], free: readonly string[], held: ReadonlyMap<string, string>): Map<string, string> {
  const open = new Set(free);
  const out = new Map<string, string>();
  const keep = (id: string) => {
    const desk = held.get(id);
    if (desk === undefined || !open.has(desk)) return;
    out.set(id, desk);
    open.delete(desk);
  };
  /** Its turn is over, and it may sit again: it has a desk to come back to. One of another repository never sits. */
  const resting = (v: Pick<Visitor, 'status' | 'lobby'>) => !v.lobby && !wantsDesk(v);
  for (const v of visitors) if (wantsDesk(v)) keep(v.id);
  const awaited = new Set<string>();
  for (const v of visitors) {
    const desk = resting(v) ? held.get(v.id) : undefined;
    if (desk !== undefined && open.has(desk)) awaited.add(desk);
  }
  for (const v of visitors) {
    if (!wantsDesk(v) || out.has(v.id)) continue;
    const desk = free.find((d) => open.has(d) && !awaited.has(d)) ?? free.find((d) => open.has(d));
    if (desk === undefined) break;
    out.set(v.id, desk);
    open.delete(desk);
  }
  for (const v of visitors) if (resting(v)) keep(v.id);
  return out;
}

/**
 * The lobby spot of each visitor, of `count` spots: the one it had (`held`), and for one that's new,
 * the first nobody has. It keeps it while it's at a desk too, so it has somewhere to walk back to and
 * nobody shuffles along when someone leaves.
 */
export function assignSpots(ids: readonly string[], held: ReadonlyMap<string, number>, count: number): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const id of ids) {
    const spot = held.get(id);
    if (spot === undefined || spot >= count || taken.has(spot)) continue;
    out.set(id, spot);
    taken.add(spot);
  }
  let next = 0;
  for (const id of ids) {
    if (out.has(id)) continue;
    while (taken.has(next)) next++;
    if (next >= count) break;
    out.set(id, next);
    taken.add(next);
  }
  return out;
}
