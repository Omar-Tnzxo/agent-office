// Tickets: a floor whose repository keeps its work as work/<id>/ticket.md (front matter, and a chain
// log of who handed what to whom), read by the office and never written (see server/tickets/). What
// a floor is sent of them is small and bounded: the open tickets, the latest rows of their chain
// logs and what waits on the owner, plus each handoff as it happens.

/** What a chain-log row did: passed the work on, sent it back to be redone, or handed it in to be looked over. */
export type HandoffKind = 'handoff' | 'return' | 'review';

export interface TicketSummary {
  id: string;
  /** Its folder under work/: what the office goes by (its front matter's id may say otherwise). */
  folder: string;
  /** Its goal's first words, else its id. */
  title: string;
  /** The stage waiting to be done, and who does it (a role's slug). */
  stage: string;
  status: string;
  next?: string;
  /** Not to be done before this (as the ticket writes it). */
  due?: string;
  line?: string;
  /** Its stage is someone looking it over (see isReviewStage in shared/tickets.ts). */
  review: boolean;
}

/** One row of a ticket's chain log: `role` did a stage, and passed it to `next`. */
export interface ChainRow {
  /** The ticket's folder. */
  ticket: string;
  when: string;
  role: string;
  did: string;
  result: string;
  /** The role it went to (a slug), when the row names one. */
  next?: string;
  kind: HandoffKind;
  /** It left the ticket where it was ("no change of stage"): no handoff. */
  same?: true;
}

/** Something waiting on the owner: a file in approvals/pending/. */
export interface ApprovalSummary {
  /** Its file's name, without .md. */
  id: string;
  /** The ticket it's about (its folder, as the file says it). */
  ticket?: string;
  sent?: string;
  /** What's to be decided. */
  decision?: string;
}

/** A floor's tickets. `on`: its repository keeps them; nothing of the rest shows without. */
export interface TicketsState {
  on: boolean;
  /** The open tickets, the most recently written first, at most TICKETS_SHOWN. */
  tickets: TicketSummary[];
  /** How many more are open than are listed. */
  more: number;
  /** The latest rows of the chain logs, newest first, at most TICKET_LOG_ROWS. */
  log: ChainRow[];
  /** What waits on the owner, at most TICKET_APPROVALS. */
  approvals: ApprovalSummary[];
  /** The roles the repository has a card for (roles/<slug>.md), by slug: their names. */
  roles: Record<string, string>;
}

export const TICKETS_SHOWN = 40;
export const TICKET_LOG_ROWS = 12;
export const TICKET_APPROVALS = 20;

export const NO_TICKETS: TicketsState = { on: false, tickets: [], more: 0, log: [], approvals: [], roles: {} };

/** A new row in a ticket's chain log, the moment the office saw it: `from` handed the ticket to `to`. */
export interface Handoff {
  /** The ticket's folder. */
  ticket: string;
  title: string;
  from: string;
  to: string;
  /** The ticket's stage now, the row's result, and the few words its giver says handing it over. */
  stage: string;
  result: string;
  say: string;
  kind: HandoffKind;
  /** When the office saw it (ms). */
  at: number;
}

export type TicketsServerMsg = { t: 'tickets'; state: TicketsState } | { t: 'tickets.handoff'; handoff: Handoff };

/** A ticket for the review table's window (GET /api/tickets/ticket): its text, and the files in its folder. */
export interface TicketDetail {
  id: string;
  text: string;
  files: { name: string; size: number }[];
}

/** A file of the floor's work for that window (GET /api/tickets/file). */
export interface TicketFile {
  path: string;
  text: string;
  /** It was longer than the window shows. */
  cut?: boolean;
}
