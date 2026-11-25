// Which chain-log rows a floor has seen, by ticket folder, whichever copy of the repository they were
// read in: a row is a handoff the first time it's seen, if it comes after the last row seen before
// (a row fixed up earlier in the log is only noted). Rows going away and coming back (a branch
// checked out and back, a rebase, a file half written) are never new again, and the most rows a
// ticket has had never goes down, so a log rewritten under it isn't read as a burst of handoffs.

export interface SeenLimits {
  /** Prints kept per ticket: its latest rows'. */
  prints: number;
  /** Tickets kept at most. */
  tickets: number;
  /** A ticket no copy has any more is forgotten after this long (ms). */
  gone: number;
}

export const SEEN_LIMITS: SeenLimits = { prints: 400, tickets: 3000, gone: 10 * 60_000 };

interface Record {
  prints: Set<string>;
  /** The most rows it has had. */
  high: number;
  goneAt?: number;
}

export class Seen {
  private by = new Map<string, Record>();

  constructor(private limits: SeenLimits = SEEN_LIMITS) {}

  get size(): number {
    return this.by.size;
  }

  /**
   * Notes a ticket's rows (`prints`, the last of its `count` rows, in file order) and says which of
   * them, by index into `prints`, are new handoffs. `quiet`: only note them (a first look). A ticket
   * never seen before hands on its last row when `fresh`, and nothing otherwise.
   */
  take(folder: string, prints: readonly string[], count: number, quiet: boolean, fresh: boolean): number[] {
    let s = this.by.get(folder);
    if (!s) {
      s = { prints: new Set(), high: 0 };
      this.by.set(folder, s);
      this.add(s, prints);
      s.high = count;
      return !quiet && fresh && prints.length ? [prints.length - 1] : [];
    }
    s.goneAt = undefined;
    let last = -1;
    for (let i = prints.length - 1; i >= 0; i--) {
      if (s.prints.has(prints[i])) {
        last = i;
        break;
      }
    }
    // Rows after the last one seen are new; with none of its rows seen before, only a ticket that had none counts them.
    const counts = last >= 0 || s.high === 0;
    const out: number[] = [];
    for (let i = last + 1; i < prints.length; i++) if (!quiet && counts && !s.prints.has(prints[i])) out.push(i);
    this.add(s, prints);
    s.high = Math.max(s.high, count);
    return out;
  }

  private add(s: Record, prints: readonly string[]) {
    for (const p of prints) {
      // Kept in the order last seen, the oldest going first.
      s.prints.delete(p);
      s.prints.add(p);
    }
    while (s.prints.size > this.limits.prints) s.prints.delete(s.prints.values().next().value!);
  }

  /** The tickets some copy still has are `present`: the rest are forgotten once they've been gone a while, and the oldest past the limit. */
  keep(present: ReadonlySet<string>, now: number) {
    for (const [folder, s] of this.by) {
      if (present.has(folder)) s.goneAt = undefined;
      else if (s.goneAt === undefined) s.goneAt = now;
      else if (now - s.goneAt > this.limits.gone) this.by.delete(folder);
    }
    if (this.by.size <= this.limits.tickets) return;
    const gone = [...this.by].filter(([, s]) => s.goneAt !== undefined).sort((a, b) => a[1].goneAt! - b[1].goneAt!);
    for (const [folder] of gone) {
      if (this.by.size <= this.limits.tickets) return;
      this.by.delete(folder);
    }
    for (const folder of this.by.keys()) {
      if (this.by.size <= this.limits.tickets) return;
      this.by.delete(folder);
    }
  }
}
