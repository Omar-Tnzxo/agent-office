// Visitors are only looked at: what someone arriving on a floor is sent of them, and watching one
// over its shoulder (its Watch window: see visitors/watch.ts), which nothing can drive either.
import type { VisitorsClientMsg, VisitorsState } from '../../../shared/protocol.js';
import { throttle } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import type { Floor } from '../../floor.js';
import type { FeatureHooks, HandlerMap } from './types.js';

export const visitorsView = (ctx: Ctx, floor: Floor | undefined): VisitorsState => ctx.visitors.state(floor?.id);

/** Opening a Watch window reads the end of a transcript: at most this often per person. */
const WATCH_EVERY_MS = 250;

export const visitorHandlers = {
  'visitor.watch'(ctx, c, msg) {
    const id = str(msg.id, 64);
    if (!id || !throttle(c, 'visitor.watch', WATCH_EVERY_MS)) return;
    ctx.visitors.watch.watch(c.id, id, (m) => ctx.sendTo(c, m));
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
