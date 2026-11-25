// What a visitor is doing, as people see it: a few short lines for its laptop (screenOf), and every
// step in full for the Watch window (watchItems). Both are made from transcript entries the scanner
// or a tail has read already; nothing here reads a file.
import { SCREEN_LINES, WATCH_BODY, type ScreenLine, type WatchItem } from '../../shared/protocol.js';
import { describeToolUse } from './transcript.js';

/** A laptop line is at most this long: a little over what a laptop shows across, which clips the rest. */
const SCREEN_CHARS = 120;
/** Remembered tool names (by call id) per feed, so a result can say whose it is. */
const NAMES_KEPT = 400;

/** A Watch item before it has its place in the feed. */
export type FeedItem = Omit<WatchItem, 'seq'>;

/** What a feed keeps between entries: the tools its calls were for, and the folder its paths are in. */
export interface FeedState {
  names: Map<string, string>;
  cwd?: string;
}

export const feedState = (): FeedState => ({ names: new Map() });

/** Escape sequences and other control characters (but tabs and newlines) out of text read from a transcript. */
export function plain(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

/** One line of at most `n` characters. */
function line(text: string, n: number): string {
  const one = plain(text).replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** A body of at most `n` characters, and how much was left off. */
export function capped(text: string, n = WATCH_BODY): { body: string; cut?: number } {
  const clean = plain(text).replace(/\s+$/, '');
  return clean.length > n ? { body: clean.slice(0, n), cut: clean.length - n } : { body: clean };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A path as short as it reads well: its name on a laptop, from the session's folder in the window. */
function shortPath(p: string, short: boolean, cwd?: string): string {
  if (!p) return '';
  if (short) return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  return cwd && p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p;
}

/** A web address as its host and path. */
function hostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

/** Tools that wait on the person at the keyboard. */
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode']);
/** Tools whose result, when it went fine, says nothing the call didn't. */
const QUIET_RESULTS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'TodoWrite']);

/** What a tool call is doing, in a few words: "Editing landing.md", "$ npm run build". `short`: for a laptop. */
export function toolHeadline(name: string, input: any, short: boolean, cwd?: string): string {
  const i = input && typeof input === 'object' ? input : {};
  const file = shortPath(str(i.file_path) || str(i.notebook_path) || str(i.path), short, cwd);
  switch (name) {
    case 'Bash':
      return `$ ${line(str(i.command), 400)}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Editing ${file}`;
    case 'Write':
      return `Writing ${file}`;
    case 'Read':
      return `Reading ${file}`;
    case 'Grep':
      return `Searching: ${line(str(i.pattern), 200)}${!short && i.path ? ` in ${shortPath(str(i.path), false, cwd)}` : ''}`;
    case 'Glob':
      return `Finding ${line(str(i.pattern), 200)}`;
    case 'WebFetch':
      return `Fetching ${hostPath(str(i.url))}`;
    case 'WebSearch':
      return `Searching the web: ${line(str(i.query), 200)}`;
    case 'Agent':
    case 'Task':
      return `Subagent: ${line(str(i.description) || str(i.subagent_type) || 'a task', 200)}`;
    case 'TodoWrite':
      return 'Updating its to-do list';
    case 'AskUserQuestion': {
      const q = Array.isArray(i.questions) ? str(i.questions[0]?.question) : '';
      return `Waiting on you${q ? `: ${line(q, 300)}` : ''}`;
    }
    case 'ExitPlanMode':
      return 'Waiting on you: its plan is ready';
    case 'Skill':
      return `Skill: ${line(str(i.skill) || str(i.command), 100)}`;
    case 'ToolSearch':
      return 'Loading tools';
    default:
      return describeToolUse({ name, input: i });
  }
}

/** The first line `before` and `after` differ on, from each side. */
function firstChange(before: string, after: string): { del?: string; add?: string } {
  const a = before.split('\n');
  const b = after.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const del = a.slice(i).find((l) => l.trim());
  const add = b.slice(i).find((l) => l.trim());
  return { ...(del !== undefined ? { del } : {}), ...(add !== undefined ? { add } : {}) };
}

/**
 * A change as diff lines: what stayed on either side of it (two lines at most), what went, what came.
 * `- ` went, `+ ` came, `  ` stayed.
 */
export function diffOf(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const out: string[] = [];
  for (const l of a.slice(Math.max(0, start - 2), start)) out.push(`  ${l}`);
  for (const l of a.slice(start, a.length - end)) out.push(`- ${l}`);
  for (const l of b.slice(start, b.length - end)) out.push(`+ ${l}`);
  for (const l of a.slice(a.length - end, a.length - end + 2)) out.push(`  ${l}`);
  return out.join('\n');
}

/** The text of a tool's result: its text, and what else it held, by name ("[image]"). */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : b?.type === 'image' ? '[image]' : b?.type === 'tool_reference' ? str(b.tool_name) : ''))
    .filter(Boolean)
    .join('\n');
}

/** The text of a message: a string, or its text blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/**
 * A prompt as it reads: a person's words, or a slash command ("/compact"). Undefined for what isn't
 * one: the reminders and command output Claude Code puts in as the user, and a note it was stopped.
 */
function promptText(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;
  const command = /^<command-name>\s*([^<]{1,80}?)\s*<\/command-name>/.exec(t);
  if (command) return command[1].startsWith('/') ? command[1] : `/${command[1]}`;
  if (t.startsWith('<') || t.startsWith('[Request interrupted')) return undefined;
  return t;
}

/** Whether an entry is a step of the session's (or, with `sidechain`, a subagent's), not bookkeeping. */
function isStep(e: any, sidechain: boolean): boolean {
  if (!e || typeof e !== 'object' || e.isMeta) return false;
  if (e.type !== 'user' && e.type !== 'assistant') return false;
  if (e.isSidechain && !sidechain) return false;
  return !!e.message && typeof e.message === 'object';
}

/** What a tool call has to show beyond its headline: the change, the file, the list, the question. */
function toolBody(name: string, input: any): { body?: string; cut?: number; diff?: true } {
  const i = input && typeof input === 'object' ? input : {};
  if (name === 'Edit') return { ...capped(diffOf(str(i.old_string), str(i.new_string))), diff: true };
  if (name === 'MultiEdit' && Array.isArray(i.edits)) return { ...capped(i.edits.map((e: any) => diffOf(str(e?.old_string), str(e?.new_string))).join('\n@@\n')), diff: true };
  if (name === 'Write') return { ...capped(diffOf('', str(i.content))), diff: true };
  if (name === 'NotebookEdit') return { ...capped(diffOf('', str(i.new_source))), diff: true };
  if (name === 'TodoWrite' && Array.isArray(i.todos)) {
    const mark = (s: unknown) => (s === 'completed' ? '[x]' : s === 'in_progress' ? '[>]' : '[ ]');
    return capped(i.todos.map((t: any) => `${mark(t?.status)} ${line(str(t?.content) || str(t?.activeForm), 200)}`).join('\n'));
  }
  if (name === 'AskUserQuestion' && Array.isArray(i.questions)) {
    return capped(i.questions.map((q: any) => [str(q?.question), ...(Array.isArray(q?.options) ? q.options.map((o: any) => `  - ${str(o?.label)}${o?.description ? `: ${str(o.description)}` : ''}`) : [])].join('\n')).join('\n\n'));
  }
  if (name === 'ExitPlanMode') return capped(str(i.plan));
  if (name === 'Agent' || name === 'Task') return capped(str(i.prompt));
  if (name === 'WebFetch') return capped([str(i.url), str(i.prompt)].filter(Boolean).join('\n'));
  if (name === 'Bash' || name === 'Read' || name === 'Grep' || name === 'Glob' || name === 'WebSearch') return {};
  // Anything else (an MCP server's tool): what it was given.
  const shown = JSON.stringify(i, null, 2);
  return shown && shown !== '{}' ? capped(shown) : {};
}

/** Remembers which tool a call was for, so its result can say; forgets the oldest past NAMES_KEPT. */
function remember(state: FeedState, id: unknown, name: string) {
  if (typeof id !== 'string') return;
  state.names.set(id, name);
  if (state.names.size > NAMES_KEPT) state.names.delete(state.names.keys().next().value!);
}

/** The Watch window's items for one transcript entry (none for bookkeeping). `sidechain`: it's a subagent's transcript. */
export function watchItems(e: any, state: FeedState, sidechain = false): FeedItem[] {
  if (typeof e?.cwd === 'string') state.cwd = e.cwd;
  if (!isStep(e, sidechain)) return [];
  const at = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) || undefined : undefined;
  const stamp = at ? { at } : {};
  const content = e.message.content;
  const out: FeedItem[] = [];
  if (e.type === 'user') {
    if (e.origin?.kind === 'task-notification') return [{ kind: 'note', head: 'A background task finished', ...stamp }];
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: str(content) }];
    for (const b of blocks) {
      if (b?.type === 'tool_result') {
        const tool = state.names.get(str(b.tool_use_id));
        const error = b.is_error === true;
        if (tool && QUIET_RESULTS.has(tool) && !error) continue;
        out.push({ kind: 'result', id: str(b.tool_use_id), ...(tool ? { tool } : {}), ...capped(resultText(b.content)), ...(error ? { error: true as const } : {}), ...stamp });
      } else if (b?.type === 'text') {
        const text = str(b.text);
        if (/^\[Request interrupted/.test(text.trim())) out.push({ kind: 'note', head: 'Stopped by the person at the keyboard', ...stamp });
        else {
          const prompt = promptText(text);
          if (prompt) out.push({ kind: 'prompt', ...capped(prompt), ...stamp });
        }
      } else if (b?.type === 'image') out.push({ kind: 'prompt', body: '[image]', ...stamp });
    }
    return out;
  }
  for (const b of Array.isArray(content) ? content : [{ type: 'text', text: str(content) }]) {
    if (b?.type === 'text' && str(b.text).trim()) out.push({ kind: 'text', ...capped(str(b.text)), ...stamp });
    else if (b?.type === 'thinking' && str(b.thinking).trim()) out.push({ kind: 'think', ...capped(str(b.thinking)), ...stamp });
    else if (b?.type === 'tool_use' && typeof b.name === 'string') {
      const name = b.name.replace(/^mcp__.+?__/, '');
      remember(state, b.id, name);
      const sub = name === 'Bash' && typeof b.input?.description === 'string' ? line(b.input.description, 200) : undefined;
      out.push({ kind: 'tool', tool: name, id: str(b.id), head: toolHeadline(name, b.input, false, state.cwd), ...(sub ? { sub } : {}), ...toolBody(name, b.input), ...stamp });
    }
  }
  return out;
}

/** The last `n` lines of a command's output that have something on them. */
function lastLines(text: string, n: number): string[] {
  return plain(text)
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .slice(-n);
}

/**
 * What a visitor's laptop shows: its latest steps, oldest first, at most SCREEN_LINES lines. `tail` is
 * the end of its transcript, oldest entry first (as the scanner reads it).
 */
export function screenOf(tail: readonly any[]): ScreenLine[] {
  const results = new Map<string, { text: string; error: boolean }>();
  const out: ScreenLine[][] = [];
  let count = 0;
  const put = (lines: ScreenLine[]) => {
    const kept = lines.filter((l) => l.t);
    if (!kept.length) return;
    out.push(kept);
    count += kept.length;
  };
  for (let i = tail.length - 1; i >= 0 && count < SCREEN_LINES; i--) {
    const e = tail[i];
    if (!isStep(e, false)) continue;
    const content = e.message.content;
    const cwd = typeof e.cwd === 'string' ? e.cwd : undefined;
    if (e.type === 'user') {
      if (Array.isArray(content) && content.some((b: any) => b?.type === 'tool_result')) {
        for (const b of content) if (b?.type === 'tool_result') results.set(str(b.tool_use_id), { text: resultText(b.content), error: b.is_error === true });
        continue;
      }
      const text = textOf(content);
      if (/^\[Request interrupted/.test(text.trim())) put([{ k: 'err', t: 'Stopped' }]);
      else {
        const prompt = promptText(text);
        if (prompt) put([{ k: 'you', t: `> ${line(prompt, SCREEN_CHARS)}` }]);
      }
      continue;
    }
    // Its blocks in order, then put in before what came after them.
    const lines: ScreenLine[] = [];
    for (const b of Array.isArray(content) ? content : []) {
      if (b?.type === 'text' && str(b.text).trim()) lines.push({ k: 'say', t: line(str(b.text), SCREEN_CHARS) });
      if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
      const name = b.name.replace(/^mcp__.+?__/, '');
      const input = b.input ?? {};
      lines.push({ k: ASKS.has(name) ? 'ask' : 'do', t: line(toolHeadline(name, input, true, cwd), SCREEN_CHARS) });
      if (name === 'Edit' || name === 'MultiEdit') {
        const edit = name === 'Edit' ? input : Array.isArray(input.edits) ? input.edits[0] : undefined;
        const { del, add } = firstChange(str(edit?.old_string), str(edit?.new_string));
        if (del !== undefined) lines.push({ k: 'del', t: `- ${line(del, SCREEN_CHARS)}` });
        if (add !== undefined) lines.push({ k: 'add', t: `+ ${line(add, SCREEN_CHARS)}` });
      } else if (name === 'Write') {
        const first = str(input.content).split('\n').find((l) => l.trim());
        if (first) lines.push({ k: 'add', t: `+ ${line(first, SCREEN_CHARS)}` });
      }
      const result = results.get(str(b.id));
      if (result?.error) lines.push({ k: 'err', t: `x ${line(lastLines(result.text, 1)[0] ?? 'failed', SCREEN_CHARS)}` });
      else if (result && name === 'Bash') for (const l of lastLines(result.text, 2)) lines.push({ k: 'out', t: line(l, SCREEN_CHARS) });
    }
    put(lines);
  }
  return out.reverse().flat().slice(-SCREEN_LINES);
}
