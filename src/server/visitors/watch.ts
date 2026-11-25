// Watching a visitor over its shoulder: its session, step by step, for the browsers that opened its
// Watch window, read off its transcript (and its subagents') as each one grows (see tail.ts). Only a
// visitor the office lists can be watched, by its session id: nobody names a file (who may watch
// which is the handler's to say, see ws/handlers/visitors.ts). A browser watches one visitor at a
// time. A session nobody watches is kept a few seconds (flicking between two windows doesn't read
// them again), then let go of; the timer stops with the last one.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { WATCH_BACKLOG, type Subagent, type VisitorsServerMsg, type WatchAgent, type WatchItem } from '../../shared/protocol.js';
import { feedState, watchItems, type FeedState } from './feed.js';
import { TranscriptTail } from './tail.js';

/** How often a watched transcript is looked at for what's new. */
export const WATCH_EVERY_MS = 1000;
/** How long a session nobody watches any more is kept, in case its window opens again. */
export const WATCH_GRACE_MS = 10_000;
/** How many sessions may be opened afresh (their transcripts' ends read) a second, across the office. */
export const WATCH_FRESH_PER_SECOND = 3;
/** What's kept of each subagent's past for a window that opens later, and how many subagents are kept. */
const AGENT_BACKLOG = 50;
const AGENTS_KEPT = 8;
/** Where the tails of subagents that were let go of stopped, for when they come back: at most this many. */
const DROPPED_KEPT = 32;
/** How much of a transcript's end is read when watching starts: a subagent's less, its whole past is short. */
const SESSION_FROM = 2 * 1024 * 1024;
const AGENT_FROM = 512 * 1024;
/** A browser with more than this waiting to go out gets nothing new until it catches up, and then all of it. */
export const WATCH_BUSY_BYTES = 4 * 1024 * 1024;
/** The most one message carries (as JSON): the oldest items go first. */
export const WATCH_MESSAGE_CHARS = 1_500_000;
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** What the office knows of a visitor it lists: its transcript, and its subagents at work. */
export interface WatchTarget {
  file: string;
  subagents: readonly Subagent[];
}

export interface WatchDeps {
  /** A visitor the office lists now, by its session id, or undefined: it isn't one (any more). */
  find(id: string): WatchTarget | undefined;
}

/** A browser watching: how to send it something, how much it has waiting, and whether it still may watch. */
export interface Watcher {
  send(msg: VisitorsServerMsg): void;
  buffered?(): number;
  may?(): boolean;
}

interface Watching extends Required<Watcher> {
  /** Something was held back while it was busy: it gets everything once it isn't. */
  stale: boolean;
}

/** One transcript being followed: where it's read to, what its calls were, and its latest items. */
interface Feed {
  tail: TranscriptTail;
  state: FeedState;
  items: WatchItem[];
}

interface AgentFeed extends Feed {
  info: WatchAgent;
}

interface Session {
  id: string;
  file: string;
  main: Feed;
  agents: Map<string, AgentFeed>;
  /** Where the tails of subagents let go of stopped, by agent id. */
  dropped: Map<string, number>;
  /** Who watches it, by client id. */
  watchers: Map<string, Watching>;
  /** Since when nobody has (undefined while someone does). */
  idleSince?: number;
  /** The last item's place in the feed. */
  seq: number;
  /** A transcript was rewritten since the last send: its watchers get everything again. */
  reset: boolean;
}

/** A subagent's transcript, next to its session's: `<session>/subagents/`, or a workflow's folder under it. */
export function agentFile(sessionFile: string, id: string): string | undefined {
  if (!AGENT_ID.test(id)) return undefined;
  const base = path.join(sessionFile.slice(0, -'.jsonl'.length), 'subagents');
  const name = `agent-${id}.jsonl`;
  if (existsSync(path.join(base, name))) return path.join(base, name);
  let runs: string[] = [];
  try {
    runs = readdirSync(path.join(base, 'workflows'));
  } catch {
    return undefined;
  }
  for (const run of runs) {
    const file = path.join(base, 'workflows', run, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

const agentInfo = (s: Subagent, live: boolean): WatchAgent => ({ id: s.id, type: s.type, ...(s.title ? { title: s.title } : {}), live });

/** The newest of `items` that fit in one message (as JSON), oldest first; `all` says whether that's every one. */
export function fitItems(items: readonly WatchItem[], max = WATCH_MESSAGE_CHARS): { items: WatchItem[]; all: boolean } {
  let size = 0;
  let i = items.length;
  while (i > 0) {
    const next = JSON.stringify(items[i - 1]).length + 1;
    if (size + next > max) break;
    size += next;
    i--;
  }
  return { items: items.slice(i), all: i === 0 };
}

/** What watch() did: opened it, it was open already, there's no such visitor, or too many opened just now (try again). */
export type WatchResult = 'ok' | 'same' | 'gone' | 'busy';

export class VisitorWatch {
  private sessions = new Map<string, Session>();
  /** The session each client watches. */
  private byClient = new Map<string, string>();
  private timer?: NodeJS.Timeout;
  /** When sessions were last opened afresh, in the last second. */
  private opened: number[] = [];

  constructor(
    private deps: WatchDeps,
    private opts: { every?: number; grace?: number; freshPerSecond?: number; now?: () => number } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** How many sessions are being followed (and how many of those nobody watches), by how many clients (for the tests). */
  get counts(): { sessions: number; idle: number; clients: number; timer: boolean } {
    const idle = [...this.sessions.values()].filter((s) => !s.watchers.size).length;
    return { sessions: this.sessions.size, idle, clients: this.byClient.size, timer: !!this.timer };
  }

  /**
   * `client` watches visitor `id` (and stops watching whoever it watched): it's sent the visitor's
   * latest steps now, and what's new each time there is some.
   */
  watch(client: string, id: string, watcher: Watcher): WatchResult {
    if (this.byClient.get(client) === id) return 'same';
    this.unwatch(client);
    const target = this.deps.find(id);
    if (!target) {
      watcher.send({ t: 'visitor.gone', id });
      return 'gone';
    }
    let s = this.sessions.get(id);
    if (s && s.file !== target.file) {
      this.sessions.delete(id);
      s = undefined;
    }
    if (!s) {
      if (!this.mayOpen()) return 'busy';
      s = { id, file: target.file, main: { tail: new TranscriptTail(target.file, SESSION_FROM), state: feedState(), items: [] }, agents: new Map(), dropped: new Map(), watchers: new Map(), seq: 0, reset: false };
      this.sessions.set(id, s);
    }
    s.idleSince = undefined;
    // Up to date first: whoever watches it already gets what's new, the newcomer all of it.
    this.pull(s, target);
    const w: Watching = { send: watcher.send, buffered: watcher.buffered ?? (() => 0), may: watcher.may ?? (() => true), stale: false };
    s.watchers.set(client, w);
    this.byClient.set(client, id);
    this.sendAll(s, w);
    this.startTimer();
    return 'ok';
  }

  /** `client` stops watching (only `id`, when given: a window that closed after another opened). */
  unwatch(client: string, id?: string) {
    const was = this.byClient.get(client);
    if (was === undefined || (id !== undefined && id !== was)) return;
    this.byClient.delete(client);
    const s = this.sessions.get(was);
    if (!s) return;
    s.watchers.delete(client);
    if (!s.watchers.size) s.idleSince = this.now();
  }

  /** Looks at every watched transcript for what's new, lets go of visitors that have left, and of sessions idle too long. */
  poll() {
    const now = this.now();
    for (const s of [...this.sessions.values()]) {
      // Whoever may no longer watch it (demoted, gone to another floor) is told it's over.
      for (const [client, w] of s.watchers) {
        if (w.may()) continue;
        s.watchers.delete(client);
        this.byClient.delete(client);
        w.send({ t: 'visitor.gone', id: s.id });
        if (!s.watchers.size) s.idleSince = now;
      }
      if (!s.watchers.size) {
        if (now - (s.idleSince ?? now) >= (this.opts.grace ?? WATCH_GRACE_MS)) this.sessions.delete(s.id);
        continue;
      }
      const target = this.deps.find(s.id);
      if (!target || target.file !== s.file) this.end(s);
      else this.pull(s, target);
    }
    if (!this.sessions.size) this.stopTimer();
  }

  stop() {
    this.sessions.clear();
    this.byClient.clear();
    this.stopTimer();
  }

  /** Whether another session may be opened afresh now (at most WATCH_FRESH_PER_SECOND a second). */
  private mayOpen(): boolean {
    const now = this.now();
    this.opened = this.opened.filter((t) => now - t < 1000);
    if (this.opened.length >= (this.opts.freshPerSecond ?? WATCH_FRESH_PER_SECOND)) return false;
    this.opened.push(now);
    return true;
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.opts.every ?? WATCH_EVERY_MS);
    this.timer.unref();
  }

  private stopTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The visitor left the office: its watchers are told, and nothing of it is kept. */
  private end(s: Session) {
    this.sessions.delete(s.id);
    for (const [client, w] of s.watchers) {
      this.byClient.delete(client);
      w.send({ t: 'visitor.gone', id: s.id });
    }
  }

  /** Everything kept of the session, as one message that replaces what the window shows. */
  private sendAll(s: Session, w: Watching) {
    w.send({ t: 'visitor.feed', id: s.id, items: fitItems(this.backlog(s)).items, agents: this.agents(s), reset: true });
  }

  /** Reads what's new of the session and its subagents, and sends it to whoever watches. */
  private pull(s: Session, target: WatchTarget) {
    const items = this.read(s, s.main, undefined, WATCH_BACKLOG);
    let changed = false;
    const live = new Set(target.subagents.map((a) => a.id));
    // The most recently heard from first (see Sighting.subagents): at most AGENTS_KEPT are followed.
    for (const sub of target.subagents.slice(0, AGENTS_KEPT)) {
      const had = s.agents.get(sub.id);
      if (had) {
        const info = agentInfo(sub, true);
        if (JSON.stringify(info) !== JSON.stringify(had.info)) {
          had.info = info;
          changed = true;
        }
        continue;
      }
      // Room for it: the one that finished first goes, and with none finished it waits its turn.
      if (s.agents.size >= AGENTS_KEPT) {
        const done = [...s.agents.values()].find((a) => !a.info.live);
        if (!done) continue;
        this.drop(s, done);
      }
      const file = agentFile(s.file, sub.id);
      if (!file) continue;
      // One let go of before goes on from where it stopped, rather than from its end again.
      const at = s.dropped.get(sub.id);
      s.dropped.delete(sub.id);
      s.agents.set(sub.id, { tail: new TranscriptTail(file, AGENT_FROM, at), state: feedState(), items: [], info: agentInfo(sub, true) });
      changed = true;
    }
    for (const a of s.agents.values()) {
      if (!a.info.live) continue;
      // One that has just finished is read a last time.
      items.push(...this.read(s, a, a.info.id, AGENT_BACKLOG));
      if (!live.has(a.info.id)) {
        a.info = { ...a.info, live: false };
        changed = true;
      }
    }
    const reset = s.reset;
    s.reset = false;
    const delta = reset || (!items.length && !changed) ? undefined : fitItems(items);
    for (const w of s.watchers.values()) {
      // Busy: nothing more until it catches up, and then everything, so nothing is missing.
      if (w.buffered() > WATCH_BUSY_BYTES) {
        w.stale ||= reset || !!delta;
        continue;
      }
      if (reset || w.stale || (delta && !delta.all)) {
        w.stale = false;
        this.sendAll(s, w);
      } else if (delta) w.send({ t: 'visitor.feed', id: s.id, items: delta.items, agents: this.agents(s) });
    }
  }

  /** Lets go of a finished subagent, remembering where its tail stopped. */
  private drop(s: Session, a: AgentFeed) {
    s.agents.delete(a.info.id);
    const at = a.tail.resumeAt;
    if (at === undefined) return;
    s.dropped.set(a.info.id, at);
    if (s.dropped.size > DROPPED_KEPT) s.dropped.delete(s.dropped.keys().next().value!);
  }

  /** What's new in one transcript, numbered, kept (the latest `keep` of it) and handed back. */
  private read(s: Session, feed: Feed, agent: string | undefined, keep: number): WatchItem[] {
    const { entries, reset } = feed.tail.read();
    if (reset) {
      // Rewritten, or another file in its place: what was shown of it is no longer so.
      feed.items = [];
      feed.state = feedState();
      s.reset = true;
    }
    if (!entries.length) return [];
    const fresh = entries
      .flatMap((e) => watchItems(e, feed.state, agent !== undefined))
      .slice(-keep)
      .map((it) => ({ ...it, seq: ++s.seq, ...(agent !== undefined ? { agent } : {}) }));
    feed.items.push(...fresh);
    if (feed.items.length > keep) feed.items.splice(0, feed.items.length - keep);
    return fresh;
  }

  /** Everything kept of a session, in order: for a window that has just opened. */
  private backlog(s: Session): WatchItem[] {
    return [s.main.items, ...[...s.agents.values()].map((a) => a.items)].flat().sort((a, b) => a.seq - b.seq);
  }

  private agents(s: Session): WatchAgent[] {
    return [...s.agents.values()].map((a) => a.info);
  }
}
