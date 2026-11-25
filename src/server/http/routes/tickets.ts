// The review table's window: a ticket of the floor's (its text and the files in its folder), and one
// of those files or an approval, read-only (see server/tickets/), and for admins only.
import { str } from '../../office/input.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const ticketRoutes = {
  tickets: {
    method: 'GET',
    prefix: '/api/tickets/',
    auth: 'session',
    handle(ctx, { res, url, path: p, session }) {
      // The tickets themselves are for admins (the shared password counts as one, as it does in office/people.ts).
      if (session.account && session.account.role !== 'admin') return send(res, 403, { error: 'Only admins can read the tickets' });
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (p === '/api/tickets/ticket') {
        const r = ctx.tickets.ticket(floor.id, str(url.searchParams.get('id'), 120));
        return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r);
      }
      if (p === '/api/tickets/file') {
        const r = ctx.tickets.file(floor.id, str(url.searchParams.get('path'), 300));
        return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r);
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
