// Tickets take no messages: the office only reads them. What someone arriving on a floor is sent of
// them (and arriving is what starts the office looking, see server/tickets/).
import type { TicketsState } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Floor } from '../../floor.js';

export const ticketsView = (ctx: Ctx, floor: Floor | undefined): TicketsState => ctx.tickets.state(floor?.id);
