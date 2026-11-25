// Tickets: a floor whose repository keeps its work as work/<id>/ticket.md (front matter and a chain
// log, see docs/features.md) shows who hands what to whom, what's in review and what waits on the
// owner. Read-only: the office reads those files from the freshest copy of the repository (see
// source.ts) every few seconds while someone is on that floor, and never writes to them.
import { NO_TICKETS, type Handoff, type TicketDetail, type TicketFile, type TicketsServerMsg, type TicketsState } from '../../shared/protocol.js';
import { TicketReader, keepsTickets, newestTicket, readWorkFile, ticketFiles } from './reader.js';
import { GitRoots, freshest, uniqueDirs } from './source.js';

/** How often a floor someone is on is looked over. */
const EVERY_MS = 4000;
/** How often which copy to read is worked out again. */
const PICK_MS = 20_000;
/** The most of a file the window is sent. */
const FILE_BYTES = 256 * 1024;

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
  /** The copy read, and its reader. */
  reader?: TicketReader;
  pickedAt: number;
  state: TicketsState;
  sent: string;
  /** The next look is a first one: nobody was on the floor, or the copy read changed. Nothing it finds is a handoff. */
  prime: boolean;
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
          if (ft) ft.prime = true;
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
      ft = { pickedAt: -Infinity, state: NO_TICKETS, sent: JSON.stringify(NO_TICKETS), prime: true };
      this.floors.set(floor.id, ft);
    }
    if (!ft.reader || now - ft.pickedAt >= PICK_MS) {
      ft.pickedAt = now;
      const dir = await this.pick(floor, now);
      if (dir !== ft.reader?.root) {
        ft.reader = dir ? new TicketReader(dir) : undefined;
        ft.prime = true;
      }
    }
    let handoffs: Handoff[] = [];
    if (ft.reader) {
      const looked = ft.reader.look(now, ft.prime);
      ft.state = looked.state;
      handoffs = looked.handoffs;
    } else ft.state = NO_TICKETS;
    ft.prime = false;
    const key = JSON.stringify(ft.state);
    if (key !== ft.sent) {
      ft.sent = key;
      this.deps.send(floor.id, { t: 'tickets', state: ft.state });
    }
    for (const handoff of handoffs) this.deps.send(floor.id, { t: 'tickets.handoff', handoff });
  }

  /** The copy of `floor`'s repository to read (see source.ts), or none when no copy keeps tickets. */
  private async pick(floor: TicketsFloor, now: number): Promise<string | undefined> {
    const dirs: string[] = [];
    for (const cwd of this.deps.visitorFolders(floor.id)) dirs.push(...(await this.roots.of(cwd, now)));
    dirs.push(floor.dir);
    const cands = uniqueDirs(dirs)
      .filter(keepsTickets)
      .map((dir) => ({ dir, newest: newestTicket(dir) }));
    return freshest(cands);
  }

  /** The copy `floor`'s tickets are read from now. */
  private rootOf(floor: string): string | undefined {
    return this.floors.get(floor)?.reader?.root;
  }

  /** A ticket for the review table's window: its text and the files in its folder. */
  ticket(floor: string, id: string): TicketDetail | { error: string; status: number } {
    const root = this.rootOf(floor);
    const files = root ? ticketFiles(root, id) : undefined;
    const read = root && files ? readWorkFile(root, `work/${id}/ticket.md`, FILE_BYTES) : undefined;
    if (!files || !read) return { error: 'No such ticket', status: 404 };
    return { id, text: read.text, files };
  }

  /** A file of the floor's work for that window: one of a ticket's own, or an approval. */
  file(floor: string, rel: string): TicketFile | { error: string; status: number } {
    const root = this.rootOf(floor);
    const read = root ? readWorkFile(root, rel, FILE_BYTES) : undefined;
    if (!read) return { error: 'No such file', status: 404 };
    return { path: rel, text: read.text, ...(read.cut ? { cut: true } : {}) };
  }
}
