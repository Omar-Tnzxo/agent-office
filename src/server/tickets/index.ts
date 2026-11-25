// Tickets: a floor whose repository keeps its work as work/<id>/ticket.md (front matter and a chain
// log, see docs/features.md) shows who hands what to whom, what's in review and what waits on the
// owner. Read-only: the office reads those files from the copies of the repository its visitors work
// in (see source.ts) every few seconds while someone is on that floor, and never writes to them.
//
// The copies are put together ticket by ticket: of a ticket found in several, the one with the most
// rows in its chain log wins (a chain log only grows, so a stale checkout, whose files a checkout
// has only just written, never beats one further along), then the one written last. Handoffs are
// told apart by the rows a floor has seen of each ticket (see seen.ts), whichever copy they're in.
import { NO_TICKETS, TICKET_APPROVALS, TICKET_LOG_ROWS, TICKETS_SHOWN, type Handoff, type TicketDetail, type TicketFile, type TicketsServerMsg, type TicketsState } from '../../shared/protocol.js';
import { CopyReader, keepsTickets, newestTicket, readWorkFile, ticketFiles, type CopyTicket } from './reader.js';
import { sayOf } from './parse.js';
import { Seen } from './seen.js';
import { GitRoots, copiesToRead, uniqueDirs } from './source.js';
import { truncate } from '../workers/util.js';

/** How often a floor someone is on is looked over. */
const EVERY_MS = 4000;
/** How often which copies to read is worked out again. */
const PICK_MS = 20_000;
/** The most of a file the window is sent. */
const FILE_BYTES = 256 * 1024;
/** Handoffs a floor is told of at most in one look: a burst is the last of them. */
const HANDOFFS_AT_ONCE = 4;

export interface TicketsFloor {
  id: string;
  /** Its checkout. */
  dir: string;
}

export interface TicketsDeps {
  floors(): TicketsFloor[];
  /** The folders the floor's visitors work in, the one that wrote last first. */
  visitorFolders(floor: string): string[];
  /** Whether anyone is on the floor: nobody looks while nobody's there. */
  watched(floor: string): boolean;
  send(floor: string, msg: TicketsServerMsg): void;
}

interface FloorTickets {
  /** The copies read, by folder. */
  copies: Map<string, CopyReader>;
  pickedAt: number;
  state: TicketsState;
  sent: string;
  /** The rows seen of each ticket, by folder, and each ticket's stage at the last look. */
  seen: Seen;
  stages: Map<string, string>;
  /** Where each ticket was read from at the last look (the copy that won), and the approvals. */
  from: Map<string, string>;
  lead?: string;
  /** The next look only notes what it finds: nobody was on the floor. */
  quiet: boolean;
  /** It has looked once: a ticket new after that hands on its last row. */
  started: boolean;
}

/** Of one ticket in two copies, the one to go by: the most rows, then the latest written. */
export function better(a: CopyTicket, b: CopyTicket): boolean {
  return a.count !== b.count ? a.count > b.count : a.mtime > b.mtime;
}

export class Tickets {
  private floors = new Map<string, FloorTickets>();
  private roots = new GitRoots();
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private deps: TicketsDeps,
    private opts: { every?: number; off?: boolean } = {},
  ) {}

  /** A floor's tickets, for someone arriving there. Looking starts, if it had stopped. */
  state(floor: string | undefined): TicketsState {
    if (!floor || this.opts.off) return NO_TICKETS;
    this.wake();
    return this.floors.get(floor)?.state ?? NO_TICKETS;
  }

  /** Someone is in the office: look now, and every few seconds while anyone is on a floor. */
  wake() {
    if (this.opts.off || this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.opts.every ?? EVERY_MS);
    this.timer.unref();
    setImmediate(() => void this.tick());
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Looks over every floor someone is on; with nobody on any, stops until someone arrives (see state). */
  async tick(now = Date.now()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const floors = this.deps.floors();
      const ids = new Set(floors.map((f) => f.id));
      for (const id of [...this.floors.keys()]) if (!ids.has(id)) this.floors.delete(id);
      let anyone = false;
      for (const f of floors) {
        if (!this.deps.watched(f.id)) {
          const ft = this.floors.get(f.id);
          if (ft) ft.quiet = true;
          continue;
        }
        anyone = true;
        await this.look(f, now);
      }
      this.roots.prune(new Set(floors.flatMap((f) => this.deps.visitorFolders(f.id))));
      if (!anyone) this.stop();
    } finally {
      this.busy = false;
    }
  }

  /** Looks a floor over once, and tells it what changed and who handed what to whom. */
  async look(floor: TicketsFloor, now = Date.now()): Promise<void> {
    let ft = this.floors.get(floor.id);
    if (!ft) {
      ft = { copies: new Map(), pickedAt: -Infinity, state: NO_TICKETS, sent: JSON.stringify(NO_TICKETS), seen: new Seen(), stages: new Map(), from: new Map(), quiet: true, started: false };
      this.floors.set(floor.id, ft);
    }
    if (now - ft.pickedAt >= PICK_MS) {
      ft.pickedAt = now;
      const dirs = await this.pick(floor, now);
      for (const dir of [...ft.copies.keys()]) if (!dirs.includes(dir)) ft.copies.delete(dir);
      for (const dir of dirs) if (!ft.copies.has(dir)) ft.copies.set(dir, new CopyReader(dir));
    }
    const copies = [...ft.copies.values()];
    const changed = copies.map((c) => {
      // A copy's first look finds what was there already.
      const quiet = c.first;
      const folders = c.look(now);
      c.first = false;
      return { copy: c, folders, quiet };
    });
    // Ticket by ticket, the copy to go by; the approvals and roles of the copy furthest along.
    const merged = new Map<string, { t: CopyTicket; root: string }>();
    for (const c of copies) for (const [folder, t] of c.tickets) if (!merged.has(folder) || better(t, merged.get(folder)!.t)) merged.set(folder, { t, root: c.root });
    const lead = copies.reduce<CopyReader | undefined>((best, c) => (!best || c.progress > best.progress ? c : best), undefined);
    const roles = lead?.roles() ?? {};
    const handoffs = this.handoffs(ft, changed, merged, roles, now);
    ft.from = new Map([...merged].map(([folder, m]) => [folder, m.root]));
    ft.lead = lead?.root;
    ft.stages = new Map([...merged].map(([folder, m]) => [folder, m.t.summary.stage]));
    ft.seen.keep(new Set(merged.keys()), now);
    ft.quiet = false;
    ft.started = true;
    ft.state = this.stateOf(merged, lead, roles);
    const key = JSON.stringify(ft.state);
    if (key !== ft.sent) {
      ft.sent = key;
      this.deps.send(floor.id, { t: 'tickets', state: ft.state });
    }
    for (const handoff of handoffs.slice(-HANDOFFS_AT_ONCE)) this.deps.send(floor.id, { t: 'tickets.handoff', handoff });
  }

  /**
   * The rows of the tickets that read differently this look that the floor hasn't seen: handoffs,
   * to a role the repository has a card for (when it has any), never a row that left the ticket
   * where it was or one handing it to whoever wrote it.
   */
  private handoffs(ft: FloorTickets, changed: { copy: CopyReader; folders: string[]; quiet: boolean }[], merged: Map<string, { t: CopyTicket }>, roles: Record<string, string>, now: number): Handoff[] {
    const out: Handoff[] = [];
    const known = Object.keys(roles).length > 0;
    for (const { copy, folders, quiet } of changed) {
      for (const folder of folders) {
        const t = copy.tickets.get(folder);
        if (!t) continue;
        const fresh = ft.seen.take(folder, t.prints, t.count, ft.quiet || quiet, ft.started);
        let did = ft.stages.get(folder);
        for (const i of fresh) {
          const row = t.rows[i - (t.prints.length - t.rows.length)];
          const prev = did;
          did = undefined;
          if (!row || row.same) continue;
          const to = row.next ?? t.summary.next;
          if (!to || to === row.role || (known && !roles[to])) continue;
          const cur = merged.get(folder)?.t ?? t;
          out.push({ ticket: folder, title: cur.summary.title, from: row.role, to, stage: cur.summary.stage, result: truncate(row.result, 80), say: sayOf(row.kind, row.result, prev), kind: row.kind, at: Math.round(now) });
        }
      }
    }
    return out;
  }

  /** What the floor is sent: the open tickets, the latest rows in the order they were written, what waits on the owner and the roles. */
  private stateOf(merged: Map<string, { t: CopyTicket }>, lead: CopyReader | undefined, roles: Record<string, string>): TicketsState {
    const all = [...merged.values()].map((m) => m.t).sort((a, b) => b.mtime - a.mtime || a.folder.localeCompare(b.folder));
    const open = all.filter((t) => t.open);
    const log = all
      .flatMap((t, ti) => t.rows.map((row, i) => ({ row, ti, i })))
      .sort((a, b) => a.ti - b.ti || b.i - a.i)
      .slice(0, TICKET_LOG_ROWS)
      .map((r) => r.row);
    return {
      on: all.length > 0,
      tickets: open.slice(0, TICKETS_SHOWN).map((t) => t.summary),
      more: Math.max(0, open.length - TICKETS_SHOWN),
      log,
      approvals: (lead?.approvals() ?? []).slice(0, TICKET_APPROVALS),
      roles,
    };
  }

  /** The copies of `floor`'s repository to read (see source.ts): none when no copy keeps tickets. */
  private async pick(floor: TicketsFloor, now: number): Promise<string[]> {
    const dirs: string[] = [];
    for (const cwd of this.deps.visitorFolders(floor.id)) dirs.push(...(await this.roots.of(cwd, now)));
    dirs.push(floor.dir);
    const cands = uniqueDirs(dirs)
      .filter(keepsTickets)
      .map((dir) => ({ dir, newest: newestTicket(dir) }));
    return copiesToRead(cands);
  }

  /** A ticket for the review table's window, from the copy it was read from: its text and the files in its folder. */
  ticket(floor: string, folder: string): TicketDetail | { error: string; status: number } {
    const root = this.floors.get(floor)?.from.get(folder);
    const files = root ? ticketFiles(root, folder) : undefined;
    const read = root && files ? readWorkFile(root, `work/${folder}/ticket.md`, FILE_BYTES) : undefined;
    if (!files || !read) return { error: 'No such ticket', status: 404 };
    return { id: folder, text: read.text, files };
  }

  /** A file of the floor's work for that window: one of a ticket's own (from its copy), or an approval (from the copy furthest along). */
  file(floor: string, rel: string): TicketFile | { error: string; status: number } {
    const ft = this.floors.get(floor);
    const folder = /^work\/([^/]+)\//.exec(rel)?.[1];
    const root = folder ? ft?.from.get(folder) : ft?.lead;
    const read = root ? readWorkFile(root, rel, FILE_BYTES) : undefined;
    if (!read) return { error: 'No such file', status: 404 };
    return { path: rel, text: read.text, ...(read.cut ? { cut: true } : {}) };
  }
}
