// Visitors are only looked at: what someone arriving on a floor is sent of them, and watching one
// over its shoulder (its Watch window: see visitors/watch.ts), which nothing can drive either. A
// transcript holds whatever its session read and wrote, so watching is for admins only, and only a
// visitor on the floor they're on.
import type { VisitorsClientMsg, VisitorsState } from '../../../shared/protocol.js';
import { throttle, type Client } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import type { Floor } from '../../floor.js';
import type { FeatureHooks, HandlerMap } from './types.js';

export const visitorsView = (ctx: Ctx, floor: Floor | undefined): VisitorsState => ctx.visitors.state(floor?.id);

/** Opening a Watch window reads the end of a transcript: at most this often per person. */
const WATCH_EVERY_MS = 250;

/** Whether `c` may watch visitor `id`: an admin, on the floor the visitor is listed on. */
export function mayWatch(ctx: Ctx, c: Client, id: string): boolean {
  if (!ctx.meOf(c.accountId).admin) return false;
  const floor = ctx.floorOf(c);
  return !!floor && ctx.visitors.state(floor.id).visitors.some((v) => v.id === id);
}

export const visitorHandlers = {
  'visitor.watch'(ctx, c, msg) {
    const id = str(msg.id, 64);
    if (!id) return;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can watch a visitor');
    if (!mayWatch(ctx, c, id)) return ctx.sendTo(c, { t: 'visitor.gone', id });
    if (!throttle(c, 'visitor.watch', WATCH_EVERY_MS)) return;
    // Checked again each time there's something to send: a demoted admin, or one gone to another floor, stops.
    ctx.visitors.watch.watch(c.id, id, { send: (m) => ctx.sendTo(c, m), buffered: () => c.ws.bufferedAmount, may: () => mayWatch(ctx, c, id) });
  },
  'visitor.unwatch'(ctx, c, msg) {
    ctx.visitors.watch.unwatch(c.id, str(msg.id, 64));
  },
} satisfies HandlerMap<VisitorsClientMsg>;

export const visitorHooks: FeatureHooks = {
  // Its window closes as you go: you can't take it up the elevator.
  leaving: (ctx, c) => ctx.visitors.watch.unwatch(c.id),
  closed: (ctx, c) => ctx.visitors.watch.unwatch(c.id),
};
