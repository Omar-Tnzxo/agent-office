import { NO_TICKETS, type TicketsState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The floor's tickets, when its repository keeps them (see features/handoffs). */
    tickets: TicketsState;
  }
  interface Topics {
    tickets: true;
  }
}

export const tickets: Slice = {
  init(s) {
    s.tickets = NO_TICKETS;
  },
  on: {
    tickets(s, m) {
      s.tickets = m.state;
      return ['tickets'];
    },
  },
  enter(s, v) {
    s.tickets = v.tickets ?? NO_TICKETS;
    return ['tickets'];
  },
};
