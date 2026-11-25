// Which copies of a floor's repository its tickets are read from. The work happens where the floor's
// visitors are, not in the floor's own checkout: in their folders, in the git worktree each folder
// is (a T3 worktree, say), and in the checkout those worktrees belong to, which a runner may have
// told them to work in. Up to MAX_COPIES of those that keep tickets are read, the ones with the
// newest ticket.md first, and the floor's own checkout when none has any; the office puts what they
// say together ticket by ticket (see index.ts).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** A folder's git roots are asked again after this long. */
const ROOTS_TTL = 10 * 60_000;

/** One copy that could be read: its folder, and when its newest ticket.md was written (0: it has none). */
export interface Candidate {
  dir: string;
  newest: number;
}

/** The most copies read for one floor. */
export const MAX_COPIES = 6;

/**
 * The copies to read: the ones with a ticket, the newest ticket.md first, at most `max`. On a tie the
 * one listed first goes first, so list the visitors' folders first (the one that wrote last first)
 * and the floor's checkout last.
 */
export function copiesToRead(cands: readonly Candidate[], max = MAX_COPIES): string[] {
  return cands
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.newest > 0)
    .sort((a, b) => b.newest - a.newest || a.i - b.i)
    .slice(0, max)
    .map((c) => c.dir);
}

/** Each folder once, in the order first seen. */
export function uniqueDirs(dirs: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    const key = path.resolve(d);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** The roots a folder belongs to: the worktree it's in, and the main checkout that worktree is of (asked of git, once in a while). */
export class GitRoots {
  private known = new Map<string, { roots: string[]; at: number; asking?: Promise<void> }>();

  async of(cwd: string, now: number): Promise<string[]> {
    const had = this.known.get(cwd);
    if (had && (had.asking || now - had.at < ROOTS_TTL)) {
      if (had.asking) await had.asking;
      return this.known.get(cwd)?.roots ?? [cwd];
    }
    const entry: { roots: string[]; at: number; asking?: Promise<void> } = { roots: had?.roots ?? [cwd], at: now };
    this.known.set(cwd, entry);
    // A folder that's gone has no roots, until it's asked about again once its time is up.
    if (!existsSync(cwd)) {
      entry.roots = [];
      return entry.roots;
    }
    entry.asking = new Promise<void>((resolve) => {
      execFile('git', ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], { cwd, timeout: 5000, encoding: 'utf8' }, (err, out) => {
        const [top, common] = err ? [] : out.trim().split('\n');
        // The common dir of a worktree is its main checkout's .git; a bare repository's has no checkout.
        const main = common && path.basename(common) === '.git' ? path.dirname(common) : undefined;
        entry.roots = uniqueDirs([top || cwd, ...(main ? [main] : [])]);
        entry.asking = undefined;
        resolve();
      });
    });
    await entry.asking;
    return entry.roots;
  }

  /** Forgets the folders not in `keep`, so what's kept never outgrows the visitors. */
  prune(keep: ReadonlySet<string>) {
    for (const cwd of this.known.keys()) if (!keep.has(cwd)) this.known.delete(cwd);
  }
}
