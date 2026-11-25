// Reading one copy of a floor's work: the tickets under work/, what waits on the owner under
// approvals/pending/ and the role cards under roles/. Every file is stat'ed and read again only
// when it has changed, finished tickets only once a minute, and what's kept of each is small: a
// finished ticket keeps no rows once it's a day old. It only lists, stats and reads.
import { closeSync, fstatSync, openSync, readdirSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { TICKET_APPROVALS, TICKET_LOG_ROWS, TICKETS_SHOWN, type ApprovalSummary, type ChainRow, type Handoff, type TicketsState, type TicketSummary } from '../../shared/protocol.js';
import { isOpenStatus, isReviewStage } from '../../shared/tickets.js';
import { parseApproval, parseTicket, roleTitle, sayOf } from './parse.js';
import { truncate } from '../workers/util.js';

export interface ReaderLimits {
  /** The most ticket folders looked at: the last ones by name (a ticket's id starts with its date). */
  folders: number;
  /** Rows of its chain log a ticket keeps, for the floor's latest rows. */
  rows: number;
  /** A finished ticket is only stat'ed again this often. */
  restat: number;
  /** A finished ticket untouched this long keeps no rows. */
  stale: number;
  /** New rows the office says it saw at most in one look: a burst is the last of them. */
  handoffs: number;
  /** The most of a file that's read. */
  bytes: number;
}

export const READER_LIMITS: ReaderLimits = { folders: 1000, rows: 6, restat: 60_000, stale: 24 * 3600_000, handoffs: 4, bytes: 512 * 1024 };

const FOLDER = /^[\w.-]{1,120}$/;

interface Known {
  mtime: number;
  size: number;
  checkedAt: number;
  summary: TicketSummary;
  open: boolean;
  /** Its chain log's rows in all, and the last few of them. */
  count: number;
  rows: ChainRow[];
}

interface Cached<T> {
  mtime: number;
  size: number;
  value: T;
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function stat(file: string): { mtime: number; size: number } | undefined {
  try {
    const s = statSync(file);
    return s.isFile() ? { mtime: s.mtimeMs, size: s.size } : undefined;
  } catch {
    return undefined;
  }
}

/** A file's text, its first `bytes` of it at most. */
export function readHead(file: string, bytes: number): { text: string; cut: boolean } | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, 0);
    return { text: buf.toString('utf8'), cut: len < size };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The ticket folders under `work`, the last `max` by name. */
export function ticketFolders(root: string, max: number): string[] {
  return list(path.join(root, 'work'))
    .filter((n) => FOLDER.test(n))
    .sort()
    .slice(-max);
}

/** When the newest ticket.md under `root` was written: 0 with none. */
export function newestTicket(root: string, max = READER_LIMITS.folders): number {
  let newest = 0;
  for (const name of ticketFolders(root, max)) newest = Math.max(newest, stat(path.join(root, 'work', name, 'ticket.md'))?.mtime ?? 0);
  return newest;
}

/** One copy of a floor's work, read again as it changes. */
export class TicketReader {
  private known = new Map<string, Known>();
  private approvals = new Map<string, Cached<ApprovalSummary>>();
  private roles = new Map<string, Cached<string | undefined>>();

  constructor(
    readonly root: string,
    private limits: ReaderLimits = READER_LIMITS,
  ) {}

  /**
   * Looks the work over once: what the floor is to be sent, and the rows added to a chain log since
   * the last look. `prime`: this is a first look (or the first after nobody watched), so nothing
   * found is new and no row is a handoff.
   */
  look(now: number, prime: boolean): { state: TicketsState; handoffs: Handoff[] } {
    const handoffs: Handoff[] = [];
    const names = ticketFolders(this.root, this.limits.folders);
    const listed = new Set(names);
    for (const name of [...this.known.keys()]) if (!listed.has(name)) this.known.delete(name);
    for (const name of names) {
      const had = this.known.get(name);
      if (had && !had.open && now - had.checkedAt < this.limits.restat) continue;
      const file = path.join(this.root, 'work', name, 'ticket.md');
      const st = stat(file);
      if (!st) {
        this.known.delete(name);
        continue;
      }
      if (had && had.mtime === st.mtime && had.size === st.size) {
        had.checkedAt = now;
        continue;
      }
      const text = readHead(file, this.limits.bytes)?.text;
      const t = text === undefined ? undefined : parseTicket(name, text);
      if (!t) {
        this.known.delete(name);
        continue;
      }
      const open = isOpenStatus(t.status);
      const summary: TicketSummary = {
        id: t.id,
        title: t.title,
        stage: t.stage,
        status: t.status,
        ...(t.next ? { next: t.next } : {}),
        ...(t.due ? { due: t.due } : {}),
        ...(t.line ? { line: t.line } : {}),
        review: isReviewStage(t.stage),
      };
      const keepRows = open || now - st.mtime < this.limits.stale;
      this.known.set(name, { mtime: st.mtime, size: st.size, checkedAt: now, summary, open, count: t.rows.length, rows: keepRows ? t.rows.slice(-this.limits.rows) : [] });
      if (prime) continue;
      // Rows past the ones there last time are handoffs; a ticket that's new since then hands on its last one.
      const fresh = had ? t.rows.slice(had.count) : t.rows.slice(-1);
      let did = had?.summary.stage;
      for (const row of fresh) {
        const to = row.next ?? t.next;
        if (to && to !== row.role) {
          handoffs.push({ ticket: t.id, title: t.title, from: row.role, to, stage: t.stage, result: truncate(row.result, 80), say: sayOf(row.kind, row.result, did), kind: row.kind, at: Math.round(now) });
        }
        did = undefined;
      }
    }
    return { state: this.state(), handoffs: handoffs.slice(-this.limits.handoffs) };
  }

  /** What the floor is sent: the open tickets, the latest rows and what waits on the owner. */
  private state(): TicketsState {
    const all = [...this.known.values()];
    const open = all.filter((k) => k.open).sort((a, b) => b.mtime - a.mtime || a.summary.id.localeCompare(b.summary.id));
    const rows = all
      .flatMap((k) => k.rows.map((row, i) => ({ row, at: k.mtime, i })))
      .sort((a, b) => b.row.when.localeCompare(a.row.when) || b.at - a.at || b.i - a.i)
      .slice(0, TICKET_LOG_ROWS)
      .map((r) => r.row);
    return {
      on: all.length > 0,
      tickets: open.slice(0, TICKETS_SHOWN).map((k) => k.summary),
      more: Math.max(0, open.length - TICKETS_SHOWN),
      log: rows,
      approvals: this.pending(),
      roles: this.roleNames(),
    };
  }

  /** A file under `dir` read again only when it has changed, kept in `cache` (which loses what's gone). */
  private cached<T>(dir: string, max: number, cache: Map<string, Cached<T>>, read: (name: string, text: string) => T): [string, T][] {
    const names = list(dir)
      .filter((n) => n.endsWith('.md') && FOLDER.test(n))
      .sort()
      .slice(-max);
    const seen = new Set(names);
    for (const n of [...cache.keys()]) if (!seen.has(n)) cache.delete(n);
    const out: [string, T][] = [];
    for (const n of names) {
      const file = path.join(dir, n);
      const st = stat(file);
      if (!st) continue;
      let had = cache.get(n);
      if (!had || had.mtime !== st.mtime || had.size !== st.size) {
        const text = readHead(file, 64 * 1024)?.text ?? '';
        had = { mtime: st.mtime, size: st.size, value: read(n.slice(0, -3), text) };
        cache.set(n, had);
      }
      out.push([n, had.value]);
    }
    return out;
  }

  private pending(): ApprovalSummary[] {
    return this.cached(path.join(this.root, 'approvals', 'pending'), 200, this.approvals, parseApproval)
      .map(([, a]) => a)
      .sort((a, b) => (b.sent ?? '').localeCompare(a.sent ?? '') || b.id.localeCompare(a.id))
      .slice(0, TICKET_APPROVALS);
  }

  private roleNames(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [n, title] of this.cached(path.join(this.root, 'roles'), 60, this.roles, (_name, text) => roleTitle(text))) if (title) out[n.slice(0, -3).toLowerCase()] = title;
    return out;
  }
}

/** Whether `root` has a work folder of tickets at all: worth reading. */
export function keepsTickets(root: string): boolean {
  return ticketFolders(root, 1).length > 0;
}

/**
 * A ticket's Markdown file or an approval in `root`, for the review table's window: only those, and
 * only where they really are (a link out of the repository is no way out of it).
 */
export function readWorkFile(root: string, rel: string, bytes = READER_LIMITS.bytes): { text: string; cut: boolean } | undefined {
  if (!/^(work\/[\w.-]{1,120}\/[\w.-]{1,120}\.md|approvals\/(pending|decided)\/[\w.-]{1,120}\.md)$/.test(rel) || rel.split('/').some((p) => /^\.+$/.test(p))) return undefined;
  try {
    const base = realpathSync(root);
    const file = realpathSync(path.join(root, ...rel.split('/')));
    if (path.relative(base, file).split(path.sep).join('/') !== rel || !stat(file)) return undefined;
    return readHead(file, bytes);
  } catch {
    return undefined;
  }
}

/** The Markdown files in a ticket's folder, by name, with their sizes. */
export function ticketFiles(root: string, id: string): { name: string; size: number }[] | undefined {
  if (!FOLDER.test(id)) return undefined;
  const dir = path.join(root, 'work', id);
  const names = list(dir).filter((n) => n.endsWith('.md') && FOLDER.test(n));
  if (!names.includes('ticket.md')) return undefined;
  return names
    .sort()
    .slice(0, 100)
    .map((name) => ({ name, size: stat(path.join(dir, name))?.size ?? 0 }));
}
