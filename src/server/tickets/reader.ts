// Reading one copy of a floor's work: the tickets under work/, what waits on the owner under
// approvals/pending/ and the role cards under roles/. Every file is stat'ed and read again only
// when it has changed, finished tickets only once a minute, and what's kept of each is small: the
// last few rows of its chain log and a short print of every row (see rowPrint), and a finished
// ticket keeps no rows once it's a day old. A link (to a file or a folder) is never followed. It
// only lists, stats and reads. Which rows are handoffs is the floor's business (see seen.ts).
import { closeSync, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { ApprovalSummary, ChainRow, TicketSummary } from '../../shared/protocol.js';
import { isOpenStatus, isReviewStage } from '../../shared/tickets.js';
import { parseApproval, parseTicket, roleTitle, rowPrint } from './parse.js';

export interface ReaderLimits {
  /** The most ticket folders looked at: the last ones by name (a ticket's id starts with its date). */
  folders: number;
  /** Rows of its chain log a ticket keeps whole, for the floor's latest rows and its handoffs. */
  rows: number;
  /** Rows a ticket keeps a print of: the last ones. */
  prints: number;
  /** A finished ticket is only stat'ed again this often. */
  restat: number;
  /** A finished ticket untouched this long keeps no rows. */
  stale: number;
  /** A ticket that can't be read (half written, say) is kept as it last read for this long. */
  failKeep: number;
  /** The most of a file that's read. */
  bytes: number;
}

export const READER_LIMITS: ReaderLimits = { folders: 1000, rows: 6, prints: 400, restat: 60_000, stale: 24 * 3600_000, failKeep: 60_000, bytes: 512 * 1024 };

const FOLDER = /^[\w.-]{1,120}$/;

/** A ticket in one copy, as it last read. */
export interface CopyTicket {
  folder: string;
  mtime: number;
  size: number;
  checkedAt: number;
  /** When it first failed to read, while it does. */
  failedAt?: number;
  summary: TicketSummary;
  open: boolean;
  /** Its chain log's rows in all, a print of each of the last READER_LIMITS.prints, and the last few whole. */
  count: number;
  prints: string[];
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

/** A file's size and time: never one through a link. */
function fileStat(file: string): { mtime: number; size: number } | undefined {
  try {
    const s = lstatSync(file);
    return s.isFile() ? { mtime: s.mtimeMs, size: s.size } : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `dir` is a folder of its own, not a link to one. */
function realDir(dir: string): boolean {
  try {
    return lstatSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Whether `dir` (through any links on the way) is still inside `root`. */
export function inside(root: string, dir: string): boolean {
  try {
    const rel = path.relative(realpathSync(root), realpathSync(dir));
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
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

/** The ticket folders under `work`, the last `max` by name: folders of their own, in a work folder inside `root`. */
export function ticketFolders(root: string, max: number): string[] {
  const work = path.join(root, 'work');
  if (!realDir(work) || !inside(root, work)) return [];
  return list(work)
    .filter((n) => FOLDER.test(n))
    .sort()
    .slice(-max);
}

/** When the newest ticket.md under `root` was written, of its last `max` folders by name: 0 with none. */
export function newestTicket(root: string, max = 50): number {
  let newest = 0;
  for (const name of ticketFolders(root, max)) if (realDir(path.join(root, 'work', name))) newest = Math.max(newest, fileStat(path.join(root, 'work', name, 'ticket.md'))?.mtime ?? 0);
  return newest;
}

/** One copy of a floor's work, read again as it changes. */
export class CopyReader {
  private known = new Map<string, CopyTicket>();
  private approvalCache = new Map<string, Cached<ApprovalSummary>>();
  private roleCache = new Map<string, Cached<string | undefined>>();
  /** It hasn't looked yet: what its first look finds was there already. */
  first = true;

  constructor(
    readonly root: string,
    private limits: ReaderLimits = READER_LIMITS,
  ) {}

  /** Its tickets, by folder. */
  get tickets(): ReadonlyMap<string, CopyTicket> {
    return this.known;
  }

  /** How far along its work is, all told: its tickets' rows. A stale checkout has fewer. */
  get progress(): number {
    let n = 0;
    for (const t of this.known.values()) n += t.count;
    return n;
  }

  /** Looks the work over once: the folders whose ticket read differently this time. */
  look(now: number): string[] {
    const changed: string[] = [];
    const names = ticketFolders(this.root, this.limits.folders);
    const listed = new Set(names);
    for (const name of [...this.known.keys()]) if (!listed.has(name)) this.known.delete(name);
    for (const name of names) {
      const had = this.known.get(name);
      if (had && !had.open && !had.failedAt && now - had.checkedAt < this.limits.restat) continue;
      const dir = path.join(this.root, 'work', name);
      const file = path.join(dir, 'ticket.md');
      const st = realDir(dir) ? fileStat(file) : undefined;
      if (had && st && had.mtime === st.mtime && had.size === st.size && !had.failedAt) {
        had.checkedAt = now;
        continue;
      }
      const text = st ? readHead(file, this.limits.bytes)?.text : undefined;
      const t = text === undefined ? undefined : parseTicket(name, text);
      if (!t) {
        // Half written, or gone for a moment: as it last read, for a while, rather than forgotten.
        if (had) {
          had.failedAt ??= now;
          if (now - had.failedAt > this.limits.failKeep) this.known.delete(name);
        }
        continue;
      }
      const open = isOpenStatus(t.status);
      const summary: TicketSummary = {
        id: t.id,
        folder: name,
        title: t.title,
        stage: t.stage,
        status: t.status,
        ...(t.next ? { next: t.next } : {}),
        ...(t.due ? { due: t.due } : {}),
        ...(t.line ? { line: t.line } : {}),
        review: isReviewStage(t.stage),
      };
      const keepRows = open || now - st!.mtime < this.limits.stale;
      this.known.set(name, {
        folder: name,
        mtime: st!.mtime,
        size: st!.size,
        checkedAt: now,
        summary,
        open,
        count: t.rows.length,
        prints: t.rows.slice(-this.limits.prints).map(rowPrint),
        rows: keepRows ? t.rows.slice(-this.limits.rows) : [],
      });
      changed.push(name);
    }
    return changed;
  }

  /** A file under `dir` read again only when it has changed, kept in `cache` (which loses what's gone). */
  private cached<T>(dir: string, max: number, cache: Map<string, Cached<T>>, read: (name: string, text: string) => T): [string, T][] {
    const names = realDir(dir) && inside(this.root, dir) ? list(dir).filter((n) => n.endsWith('.md') && FOLDER.test(n)).sort().slice(-max) : [];
    const seen = new Set(names);
    for (const n of [...cache.keys()]) if (!seen.has(n)) cache.delete(n);
    const out: [string, T][] = [];
    for (const n of names) {
      const file = path.join(dir, n);
      const st = fileStat(file);
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

  /** What waits on the owner (approvals/pending), the latest sent first. */
  approvals(): ApprovalSummary[] {
    return this.cached(path.join(this.root, 'approvals', 'pending'), 200, this.approvalCache, parseApproval)
      .map(([, a]) => a)
      .sort((a, b) => (b.sent ?? '').localeCompare(a.sent ?? '') || b.id.localeCompare(a.id));
  }

  /** The roles it has a card for, by slug: their names. */
  roles(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [n, title] of this.cached(path.join(this.root, 'roles'), 60, this.roleCache, (_name, text) => roleTitle(text))) out[n.slice(0, -3).toLowerCase()] = title ?? n.slice(0, -3);
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
    if (path.relative(base, file).split(path.sep).join('/') !== rel || !fileStat(file)) return undefined;
    return readHead(file, bytes);
  } catch {
    return undefined;
  }
}

/** The Markdown files in a ticket's folder, by name, with their sizes: none through a link. */
export function ticketFiles(root: string, folder: string): { name: string; size: number }[] | undefined {
  if (!FOLDER.test(folder)) return undefined;
  const dir = path.join(root, 'work', folder);
  if (!realDir(dir) || !inside(root, dir)) return undefined;
  const files = list(dir)
    .filter((n) => n.endsWith('.md') && FOLDER.test(n))
    .map((name) => ({ name, st: fileStat(path.join(dir, name)) }))
    .filter((f): f is { name: string; st: { mtime: number; size: number } } => !!f.st);
  if (!files.some((f) => f.name === 'ticket.md')) return undefined;
  return files
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100)
    .map((f) => ({ name: f.name, size: f.st.size }));
}
