// Visitors: Claude Code sessions the office didn't start (the Claude desktop app, a terminal, an
// IDE), seen through the transcripts Claude Code writes under ~/.claude/projects (see
// server/visitors/). The office only ever reads those; a visitor can be looked at, never driven.

import type { Subagent } from './subagents.js';

/** How a visitor is getting on, from the latest entries of its transcript. */
export type VisitorStatus = 'working' | 'needs_input' | 'done';

/** Where a visitor's session runs. */
export type VisitorApp = 'desktop' | 'cli' | 'ide' | 'other';

export interface Visitor {
  /** Its session id. */
  id: string;
  /** Its title in the app, else its first prompt, else its folder. */
  title: string;
  app: VisitorApp;
  /** The folder it runs in, as its last two parts ("Programer/my-site"). */
  folder: string;
  branch?: string;
  status: VisitorStatus;
  /** Its latest tool call, or what it last said. */
  activity?: string;
  /** The model its latest message came from. */
  model?: string;
  /** When its transcript (or one of its subagents') was last written (ms). */
  seenAt: number;
  /** Its folder's repository is no floor's, so it waits in the lobby (the building's first floor). */
  lobby: boolean;
  /** The subagents it has running, most recent first, at most VISITOR_SUBAGENTS of them. */
  subagents: Subagent[];
  /** How many it has running in all. */
  subagentCount: number;
  /** What its laptop shows: its latest steps, oldest first, at most SCREEN_LINES of them. */
  screen?: ScreenLine[];
}

/** A visitor shows at most this many of its subagents round it; the rest are a count on its card. */
export const VISITOR_SUBAGENTS = 8;

/** The visitors on one floor. `off`: the office was started with --no-visitors. */
export interface VisitorsState {
  visitors: Visitor[];
  off?: boolean;
}

/**
 * A floor's visitors, when they change. `caughtUp`: the office hadn't looked for a while (nobody was in
 * it), so whoever is new or at work on this list was so already: nobody walks in, they're where they sit.
 */
export type VisitorsServerMsg =
  | { t: 'visitors'; state: VisitorsState; caughtUp?: true }
  /** What a visitor you watch did (see WatchItem): its latest on `reset` (the window has just opened), else what's new since. */
  | { t: 'visitor.feed'; id: string; items: WatchItem[]; agents: WatchAgent[]; reset?: true }
  /** The visitor you watch has left the office: its feed ends here. */
  | { t: 'visitor.gone'; id: string };

/** Watching a visitor: its session, live, read off its transcript (see server/visitors/watch.ts). One at a time. */
export type VisitorsClientMsg = { t: 'visitor.watch'; id: string } | { t: 'visitor.unwatch'; id: string };

/**
 * A line of a visitor's laptop. `say`: what it wrote; `do`: a tool call ("Editing landing.md");
 * `add`/`del`: a line it put in or took out; `out`: a command's output; `ask`: it waits on you;
 * `you`: a prompt it was given; `err`: something that failed.
 */
export interface ScreenLine {
  k: 'say' | 'do' | 'add' | 'del' | 'out' | 'ask' | 'you' | 'err';
  t: string;
}

/** A visitor's laptop shows at most this many of its latest lines. */
export const SCREEN_LINES = 10;

/**
 * One thing a watched visitor did, as the Watch window shows it: a prompt it was given, what it
 * wrote, what it thought, a tool call (with what it was asked to do), a tool's result, or a note.
 */
export interface WatchItem {
  /** Its place in the feed: later items have higher numbers. */
  seq: number;
  /** The subagent it came from; none: the session itself. */
  agent?: string;
  kind: 'prompt' | 'text' | 'think' | 'tool' | 'result' | 'note';
  /** A tool call's tool, or the tool a result is from. */
  tool?: string;
  /** A tool call's id, which its result carries too. */
  id?: string;
  /** One line about it: "Edit src/landing.md", "$ npm test". */
  head?: string;
  /** A second, quieter line: what a command is for. */
  sub?: string;
  /** The rest of it, at most WATCH_BODY characters: the text, the output, the change. */
  body?: string;
  /** How many characters of the body were left off. */
  cut?: number;
  /** The body is a change: lines starting "- " went, "+ " came, "  " stayed. */
  diff?: true;
  error?: true;
  /** When it was written (ms). */
  at?: number;
}

/** A subagent of a watched visitor, for its tab in the Watch window. */
export interface WatchAgent {
  id: string;
  type: string;
  title?: string;
  /** Still at work, as the office last looked. */
  live: boolean;
}

/** The most a Watch window is sent of a visitor's past on opening, and the longest a body gets. */
export const WATCH_BACKLOG = 200;
export const WATCH_BODY = 3000;
