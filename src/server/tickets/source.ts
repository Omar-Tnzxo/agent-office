// Which copy of a floor's repository its tickets are read from. The work happens where the floor's
// visitors are, not in the floor's own checkout: in their folders, in the git worktree each folder
// is (a T3 worktree, say), and in the checkout those worktrees belong to, which a runner may have
// told them to work in. Of all of those that keep tickets, the one whose newest ticket.md was
// written last is read, and the floor's checkout when none has any.
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

/**
 * The copy to read: the one with the newest ticket.md. On a tie the one listed first wins, so list
 * the visitors' folders first (the one that wrote last first) and the floor's checkout last.
 * Undefined when none has a ticket.
 */
export function freshest(cands: readonly Candidate[]): string | undefined {
  let best: Candidate | undefined;
  for (const c of cands) if (c.newest > 0 && (!best || c.newest > best.newest)) best = c;
  return best?.dir;
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
    entry.asking = new Promise<void>((resolve) => {
      if (!existsSync(cwd)) {
        entry.roots = [];
        entry.asking = undefined;
        return resolve();
      }
      execFile('git', ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], { cwd, timeout: 5000, encoding: 'utf8' }, (err, out) => {
        const [top, common] = err ? [] : out.trim().split('\n');
        // The common dir of a worktree is its main checkout's .git; a bare repository's has no checkout.
        const main = common && path.basename(common) === '.git' ? path.dirname(common) : undefined;
        entry.roots = uniqueDirs([top || cwd, ...(main ? [main] : [])]);
        entry.asking = undefined;
        resolve();
      });
    });
    this.known.set(cwd, entry);
    await entry.asking;
    return entry.roots;
  }

  /** Forgets the folders not in `keep`, so what's kept never outgrows the visitors. */
  prune(keep: ReadonlySet<string>) {
    for (const cwd of this.known.keys()) if (!keep.has(cwd)) this.known.delete(cwd);
  }
}
