// Watching a visitor over its shoulder: its session, step by step, for the browsers that opened its
// Watch window, read off its transcript (and its subagents') as each one grows (see tail.ts). Only a
// visitor the office lists can be watched, by its session id: nobody names a file. A browser watches
// one visitor at a time; a session nobody watches any more is let go of, and the timer stops with
// the last one.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { WATCH_BACKLOG, type Subagent, type VisitorsServerMsg, type WatchAgent, type WatchItem } from '../../shared/protocol.js';
import { feedState, watchItems, type FeedState } from './feed.js';
import { TranscriptTail } from './tail.js';

/** How often a watched transcript is looked at for what's new. */
export const WATCH_EVERY_MS = 1000;
/** What's kept of each subagent's past for a window that opens later, and how many subagents are kept. */
const AGENT_BACKLOG = 50;
const AGENTS_KEPT = 8;
/** How much of a transcript's end is read when watching starts: a subagent's less, its whole past is short. */
const SESSION_FROM = 2 * 1024 * 1024;
const AGENT_FROM = 512 * 1024;
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

type Send = (msg: VisitorsServerMsg) => void;

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
  /** Who watches it, by client id. */
  watchers: Map<string, Send>;
  /** The last item's place in the feed. */
  seq: number;
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

export class VisitorWatch {
  private sessions = new Map<string, Session>();
  /** The session each client watches. */
  private byClient = new Map<string, string>();
  private timer?: NodeJS.Timeout;

  constructor(
    private deps: WatchDeps,
    private every = WATCH_EVERY_MS,
  ) {}

  /** How many sessions are being followed, and by how many clients (for the tests). */
  get counts(): { sessions: number; clients: number; timer: boolean } {
    return { sessions: this.sessions.size, clients: this.byClient.size, timer: !!this.timer };
  }

  /**
   * `client` watches visitor `id` (and stops watching whoever it watched): it's sent the visitor's
   * latest steps now, and what's new each time there is some. False when there's no such visitor.
   */
  watch(client: string, id: string, send: Send): boolean {
    this.unwatch(client);
    const target = this.deps.find(id);
    if (!target) {
      send({ t: 'visitor.gone', id });
      return false;
    }
    let s = this.sessions.get(id);
    if (!s) {
      s = { id, file: target.file, main: { tail: new TranscriptTail(target.file, SESSION_FROM), state: feedState(), items: [] }, agents: new Map(), watchers: new Map(), seq: 0 };
      this.sessions.set(id, s);
    }
    // Up to date first: whoever watches it already gets what's new, the newcomer all of it.
    this.pull(s, target);
    s.watchers.set(client, send);
    this.byClient.set(client, id);
    send({ t: 'visitor.feed', id, items: this.backlog(s), agents: this.agents(s), reset: true });
    this.startTimer();
    return true;
  }

  /** `client` stops watching (only `id`, when given: a window that closed after another opened). */
  unwatch(client: string, id?: string) {
    const was = this.byClient.get(client);
    if (was === undefined || (id !== undefined && id !== was)) return;
    this.byClient.delete(client);
    const s = this.sessions.get(was);
    s?.watchers.delete(client);
    if (s && !s.watchers.size) this.sessions.delete(was);
    if (!this.sessions.size) this.stopTimer();
  }

  /** Looks at every watched transcript for what's new, and lets go of visitors that have left. */
  poll() {
    for (const s of [...this.sessions.values()]) {
      const target = this.deps.find(s.id);
      if (!target || target.file !== s.file) this.end(s);
      else this.pull(s, target);
    }
  }

  stop() {
    this.sessions.clear();
    this.byClient.clear();
    this.stopTimer();
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.every);
    this.timer.unref();
  }

  private stopTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The visitor left the office: its watchers are told, and nothing of it is kept. */
  private end(s: Session) {
    this.sessions.delete(s.id);
    for (const [client, send] of s.watchers) {
      this.byClient.delete(client);
      send({ t: 'visitor.gone', id: s.id });
    }
    if (!this.sessions.size) this.stopTimer();
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
        s.agents.delete(done.info.id);
      }
      const file = agentFile(s.file, sub.id);
      if (!file) continue;
      s.agents.set(sub.id, { tail: new TranscriptTail(file, AGENT_FROM), state: feedState(), items: [], info: agentInfo(sub, true) });
      changed = true;
    }
    for (const a of s.agents.values()) {
      const ended = a.info.live && !live.has(a.info.id);
      if (!a.info.live) continue;
      // One that has just finished is read a last time.
      items.push(...this.read(s, a, a.info.id, AGENT_BACKLOG));
      if (ended) {
        a.info = { ...a.info, live: false };
        changed = true;
      }
    }
    if (!items.length && !changed) return;
    for (const send of s.watchers.values()) send({ t: 'visitor.feed', id: s.id, items, agents: this.agents(s) });
  }

  /** What's new in one transcript, numbered, kept (the latest `keep` of it) and handed back. */
  private read(s: Session, feed: Feed, agent: string | undefined, keep: number): WatchItem[] {
    const { entries } = feed.tail.read();
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
