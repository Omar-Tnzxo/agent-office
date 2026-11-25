import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCREEN_LINES, WATCH_BODY, type Subagent, type Visitor, type VisitorsServerMsg } from '../src/shared/protocol.js';
import { diffOf, feedState, screenOf, toolHeadline, watchItems } from '../src/server/visitors/feed.js';
import { TranscriptTail } from '../src/server/visitors/tail.js';
import { VisitorWatch, agentFile, type WatchTarget } from '../src/server/visitors/watch.js';
import { visitorHooks } from '../src/server/ws/handlers/visitors.js';
import { COLS, ROWS, fit, screenRows, visitorScreen, wrap } from '../src/client/features/visitor-watch/screen.js';

const line = (e: object) => `${JSON.stringify(e)}\n`;
const assistant = (content: object[], extra: object = {}) => ({ type: 'assistant', message: { model: 'claude-opus-5-5', content, stop_reason: 'tool_use' }, ...extra });
const user = (content: unknown, extra: object = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const use = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: unknown, is_error?: boolean) => user([{ type: 'tool_result', tool_use_id: id, content, ...(is_error ? { is_error } : {}) }]);

function folder(t: test.TestContext) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-watch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('each tool call reads as what it does, with what it was asked to do', () => {
  const cwd = '/w/site';
  assert.equal(toolHeadline('Bash', { command: 'npm   run\nbuild' }, true), '$ npm run build');
  assert.equal(toolHeadline('Edit', { file_path: '/w/site/src/landing.md' }, true), 'Editing landing.md');
  assert.equal(toolHeadline('Edit', { file_path: '/w/site/src/landing.md' }, false, cwd), 'Editing src/landing.md');
  assert.equal(toolHeadline('Write', { file_path: '/elsewhere/a.md' }, false, cwd), 'Writing /elsewhere/a.md');
  assert.equal(toolHeadline('Read', { file_path: '/w/site/README.md' }, true), 'Reading README.md');
  assert.equal(toolHeadline('Grep', { pattern: 'budget', path: '/w/site/src' }, false, cwd), 'Searching: budget in src');
  assert.equal(toolHeadline('Grep', { pattern: 'budget', path: '/w/site/src' }, true), 'Searching: budget');
  assert.equal(toolHeadline('Glob', { pattern: '**/*.ts' }, true), 'Finding **/*.ts');
  assert.equal(toolHeadline('WebFetch', { url: 'https://example.com/pricing?x=1' }, true), 'Fetching example.com/pricing');
  assert.equal(toolHeadline('WebSearch', { query: 'cairo rents' }, true), 'Searching the web: cairo rents');
  assert.equal(toolHeadline('Agent', { description: 'Measure LCP' }, true), 'Subagent: Measure LCP');
  assert.equal(toolHeadline('AskUserQuestion', { questions: [{ question: 'Which logo?' }] }, true), 'Waiting on you: Which logo?');
  assert.equal(toolHeadline('ExitPlanMode', {}, true), 'Waiting on you: its plan is ready');
  assert.equal(toolHeadline('TodoWrite', { todos: [] }, true), 'Updating its to-do list');
  assert.equal(toolHeadline('browser_click', { url: 'x' }, true), 'browser_click: x');
});

test("a change is shown as a diff: what stayed round it, what went and what came", () => {
  assert.equal(diffOf('a\nb\nc\nd\ne', 'a\nb\nC\nd\ne'), '  a\n  b\n- c\n+ C\n  d\n  e');
  assert.equal(diffOf('', 'new\nfile'), '- \n+ new\n+ file');
  assert.equal(diffOf('x\ny', 'x\ny\nz'), '  x\n  y\n+ z');
});

test("the Watch window's items for each kind of step", () => {
  const s = feedState();
  const at = '2026-11-25T10:00:00.000Z';
  const cwd = '/w/site';
  // A prompt, a slash command; Claude Code's own reminders aren't prompts.
  assert.deepEqual(watchItems(user('Make the hero faster', { cwd, timestamp: at }), s), [{ kind: 'prompt', body: 'Make the hero faster', at: Date.parse(at) }]);
  assert.deepEqual(watchItems(user('<command-name>/compact</command-name>'), s), [{ kind: 'prompt', body: '/compact' }]);
  assert.deepEqual(watchItems(user('<system-reminder>x</system-reminder>'), s), []);
  assert.deepEqual(watchItems(user('[Request interrupted by user]'), s), [{ kind: 'note', head: 'Stopped by the person at the keyboard' }]);
  assert.deepEqual(watchItems({ type: 'user', isMeta: true, message: { content: 'meta' } }, s), []);
  assert.deepEqual(watchItems({ type: 'api-request-blob', message: { role: 'user', content: 'a system prompt' } }, s), []);
  // A subagent's steps in the session's own transcript are its, not the session's.
  assert.deepEqual(watchItems(assistant([{ type: 'text', text: 'side' }], { isSidechain: true }), s), []);
  assert.equal(watchItems(assistant([{ type: 'text', text: 'side' }], { isSidechain: true }), s, true).length, 1);

  // What it wrote and thought, and a command with what it's for, then its output under it.
  const said = watchItems(assistant([{ type: 'thinking', thinking: 'Hmm.' }, { type: 'text', text: 'Building it.' }, use('t1', 'Bash', { command: 'npm run build', description: 'Build the site' })]), s);
  assert.deepEqual(said, [
    { kind: 'think', body: 'Hmm.' },
    { kind: 'text', body: 'Building it.' },
    { kind: 'tool', tool: 'Bash', id: 't1', head: '$ npm run build', sub: 'Build the site' },
  ]);
  assert.deepEqual(watchItems(result('t1', '\x1b[32mbuilt\x1b[0m in 2s\n'), s), [{ kind: 'result', id: 't1', tool: 'Bash', body: 'built in 2s' }]);
  assert.deepEqual(watchItems(result('t1', [{ type: 'text', text: 'boom' }], true), s), [{ kind: 'result', id: 't1', tool: 'Bash', body: 'boom', error: true }]);

  // Edits as diffs, from the session's folder; a fine Edit result says nothing more, a failed one does.
  const [edit] = watchItems(assistant([use('t2', 'Edit', { file_path: '/w/site/landing.md', old_string: 'Hello', new_string: 'Hi there' })]), s);
  assert.deepEqual(edit, { kind: 'tool', tool: 'Edit', id: 't2', head: 'Editing landing.md', body: '- Hello\n+ Hi there', diff: true });
  assert.deepEqual(watchItems(result('t2', 'The file was updated.'), s), []);
  assert.equal(watchItems(result('t2', 'old_string not found', true), s)[0].error, true);
  const [multi] = watchItems(assistant([use('t3', 'MultiEdit', { file_path: 'a.ts', edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] })]), s);
  assert.equal(multi.body, '- a\n+ b\n@@\n- c\n+ d');
  const [write] = watchItems(assistant([use('t4', 'Write', { file_path: '/w/site/new.md', content: '# New\nbody' })]), s);
  assert.equal(write.body, '- \n+ # New\n+ body');
  assert.equal(write.diff, true);
  const [todo] = watchItems(assistant([use('t5', 'TodoWrite', { todos: [{ content: 'Read', status: 'completed' }, { content: 'Write', status: 'in_progress' }, { content: 'Ship', status: 'pending' }] })]), s);
  assert.equal(todo.body, '[x] Read\n[>] Write\n[ ] Ship');
  const [ask] = watchItems(assistant([use('t6', 'AskUserQuestion', { questions: [{ question: 'Which?', options: [{ label: 'A', description: 'first' }, { label: 'B' }] }] })]), s);
  assert.equal(ask.head, 'Waiting on you: Which?');
  assert.equal(ask.body, 'Which?\n  - A: first\n  - B');
  const [mcp] = watchItems(assistant([use('t7', 'mcp__srv__lookup', { q: 'x' })]), s);
  assert.equal(mcp.tool, 'lookup');
  assert.equal(mcp.body, '{\n  "q": "x"\n}');
  const [read] = watchItems(assistant([use('t8', 'Read', { file_path: '/w/site/README.md' })]), s);
  assert.equal(read.body, undefined);
  assert.equal(watchItems(result('t8', [{ type: 'text', text: 'page' }, { type: 'image', source: {} }]), s)[0].body, 'page\n[image]');

  // A long output is cut at WATCH_BODY, and says how much went.
  const [long] = watchItems(result('t1', 'x'.repeat(WATCH_BODY + 50)), s);
  assert.equal(long.body!.length, WATCH_BODY);
  assert.equal(long.cut, 50);
  // A result whose call was never seen is shown all the same, without a tool.
  assert.deepEqual(watchItems(result('nope', 'hi'), s), [{ kind: 'result', id: 'nope', body: 'hi' }]);
});

test("a visitor's laptop shows its latest steps in a few short lines, the newest last", () => {
  const cwd = '/w/site';
  const tail = [
    user('Write the landing page', { cwd }),
    assistant([{ type: 'text', text: 'On it.' }, use('a', 'Read', { file_path: '/w/site/README.md' })], { cwd }),
    result('a', 'readme'),
    assistant([use('b', 'Edit', { file_path: '/w/site/landing.md', old_string: 'same\nold line', new_string: 'same\nnew line' })], { cwd }),
    result('b', 'ok'),
    assistant([use('c', 'Bash', { command: 'npm run build' })], { cwd }),
    result('c', 'step 1\n\nstep 2\nbuilt in 3s\n'),
    assistant([use('d', 'Grep', { pattern: 'budget' })], { cwd }),
  ];
  assert.deepEqual(screenOf(tail), [
    { k: 'you', t: '> Write the landing page' },
    { k: 'say', t: 'On it.' },
    { k: 'do', t: 'Reading README.md' },
    { k: 'do', t: 'Editing landing.md' },
    { k: 'del', t: '- old line' },
    { k: 'add', t: '+ new line' },
    { k: 'do', t: '$ npm run build' },
    { k: 'out', t: 'step 2' },
    { k: 'out', t: 'built in 3s' },
    { k: 'do', t: 'Searching: budget' },
  ]);
  // Waiting on you, and a failed command.
  assert.deepEqual(screenOf([assistant([use('e', 'Bash', { command: 'false' })]), result('e', 'exit 1', true), assistant([use('f', 'AskUserQuestion', { questions: [{ question: 'Ship it?' }] })])]), [
    { k: 'do', t: '$ false' },
    { k: 'err', t: 'x exit 1' },
    { k: 'ask', t: 'Waiting on you: Ship it?' },
  ]);
  // Never more than SCREEN_LINES, and the newest are the ones kept.
  const many = Array.from({ length: 30 }, (_, i) => assistant([use(`g${i}`, 'Read', { file_path: `/f${i}.md` })]));
  const shown = screenOf(many);
  assert.equal(shown.length, SCREEN_LINES);
  assert.equal(shown.at(-1)!.t, 'Reading f29.md');
  assert.deepEqual(screenOf([]), []);
});

test('the laptop screen: a title bar, the steps at the bottom, the folder along the foot, all within its columns', () => {
  assert.equal(fit('abcdef', 4), 'abc…');
  assert.deepEqual(wrap('one two three four five six', 9, 2), ['one two', 'three fo…']);
  assert.deepEqual(wrap('short', 9, 3), ['short']);
  const v: Visitor = { id: 'x', title: 'Copywriter', app: 'cli', folder: 'Work/site', branch: 'main', status: 'working', seenAt: 0, lobby: false, subagents: [], subagentCount: 0, screen: [{ k: 'say', t: 'A long sentence that wraps across more than one row of the laptop screen, and then some more words' }, { k: 'do', t: '$ npm run build' }] };
  const s = visitorScreen(v, 7);
  assert.equal(s.rows, ROWS);
  assert.equal(s.lines.length, ROWS);
  assert.equal(s.version, 7);
  const text = s.lines.map((runs) => runs.map((r) => r[0]).join(''));
  assert.match(text[0], /^ Copywriter +working $/);
  assert.equal(text.at(-1)!.trim(), 'Work/site (main)');
  assert.equal(text.at(-2), ' $ npm run build');
  for (const row of text) assert.ok([...row].length <= COLS, `"${row}" is wider than the laptop`);
  // The oldest line shown keeps its start, on the rows that are left.
  const tight = screenRows([{ k: 'say', t: 'alpha beta gamma delta '.repeat(6).trim() }, ...Array.from({ length: 9 }, (_, i) => ({ k: 'do' as const, t: `step ${i}` }))], 10);
  assert.equal(tight.length, 10);
  assert.match(tight[0][0][0], /^ alpha beta gamma .*…$/);
  assert.equal(tight[9][0][0], ' step 8');
  // Nothing read yet: what it's doing, from its card.
  const bare = visitorScreen({ ...v, screen: undefined, status: 'needs_input' }, 1);
  assert.ok(bare.lines.some((runs) => runs.some((r) => r[0].includes('Waiting on you'))));
});

test('a tail reads only what was written since, and keeps a half-written line for later', (t) => {
  const dir = folder(t);
  const file = path.join(dir, 's.jsonl');
  writeFileSync(file, line({ type: 'a', n: 1 }) + line({ type: 'a', n: 2 }));
  const tail = new TranscriptTail(file);
  assert.deepEqual(tail.read().entries.map((e) => e.n), [1, 2]);
  assert.equal(tail.offset, readFileSync(file).length);
  assert.deepEqual(tail.read().entries, []);
  // Half a line: nothing yet; its end: the entry, once.
  const next = line({ type: 'a', n: 3, text: 'héllo ✓' });
  const bytes = Buffer.from(next);
  // Split inside a multi-byte character, too.
  const cut = bytes.indexOf(Buffer.from('✓')) + 1;
  appendFileSync(file, bytes.subarray(0, cut));
  assert.deepEqual(tail.read().entries, []);
  appendFileSync(file, bytes.subarray(cut));
  assert.deepEqual(tail.read().entries.map((e) => e.text), ['héllo ✓']);
  // Rewritten shorter: read again from its start.
  writeFileSync(file, line({ type: 'b', n: 9 }));
  const again = tail.read();
  assert.equal(again.reset, true);
  assert.deepEqual(again.entries.map((e) => e.n), [9]);
});

test("a tail starts at the end of a big transcript, from its first whole line, and skips past what's too much at once", (t) => {
  const dir = folder(t);
  const file = path.join(dir, 's.jsonl');
  writeFileSync(file, Array.from({ length: 100 }, (_, n) => line({ n, pad: 'x'.repeat(50) })).join(''));
  const tail = new TranscriptTail(file, 300);
  const first = tail.read().entries.map((e) => e.n);
  assert.ok(first.length >= 2 && first.length <= 4, `read ${first.length} entries`);
  assert.equal(first.at(-1), 99);
  // 100 more at once, more than a read takes: only the newest, from a whole line.
  appendFileSync(file, Array.from({ length: 100 }, (_, i) => line({ n: 100 + i, pad: 'x'.repeat(50) })).join(''));
  const jumped = tail.read(400).entries.map((e) => e.n);
  assert.equal(jumped.at(-1), 199);
  assert.ok(jumped[0] > 150);
  // A missing file reads as nothing, and is read from its start once it's there.
  const later = new TranscriptTail(path.join(dir, 'later.jsonl'));
  assert.deepEqual(later.read().entries, []);
  writeFileSync(path.join(dir, 'later.jsonl'), line({ n: 1 }));
  assert.deepEqual(later.read().entries.map((e) => e.n), [1]);
  truncateSync(file, 0);
  assert.deepEqual(tail.read().entries, []);
});

/** A session's transcript and a subagent's, as Claude Code lays them out, and a watch over them. */
function session(t: test.TestContext) {
  const dir = folder(t);
  const file = path.join(dir, 'proj', '0000-aaaa.jsonl');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, line(user('Start', { cwd: '/w' })) + line(assistant([use('t1', 'Bash', { command: 'ls' })])));
  const targets = new Map<string, WatchTarget>([['s1', { file, subagents: [] }]]);
  const watch = new VisitorWatch({ find: (id) => targets.get(id) }, 60_000);
  t.after(() => watch.stop());
  const inbox = (): VisitorsServerMsg[] & { send: (m: VisitorsServerMsg) => void } => {
    const got = [] as unknown as VisitorsServerMsg[] & { send: (m: VisitorsServerMsg) => void };
    got.send = (m) => got.push(m);
    return got;
  };
  return { dir, file, targets, watch, inbox };
}

test('watching a visitor: its latest steps on opening, then only what is new, to everyone watching, and never a byte written', (t) => {
  const { file, watch, inbox } = session(t);
  const before = { body: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs };
  const a = inbox();
  assert.equal(watch.watch('c1', 's1', a.send), true);
  watch.poll();
  assert.deepEqual({ body: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs }, before);
  assert.equal(a.length, 1);
  const open = a[0] as Extract<VisitorsServerMsg, { t: 'visitor.feed' }>;
  assert.equal(open.reset, true);
  assert.deepEqual(open.items.map((i) => [i.seq, i.kind, i.head ?? i.body]), [[1, 'prompt', 'Start'], [2, 'tool', '$ ls']]);
  assert.deepEqual(watch.counts, { sessions: 1, clients: 1, timer: true });
  // Nothing new: nothing sent.
  watch.poll();
  assert.equal(a.length, 1);
  appendFileSync(file, line(result('t1', 'a.txt')));
  watch.poll();
  const delta = a[1] as Extract<VisitorsServerMsg, { t: 'visitor.feed' }>;
  assert.equal(delta.reset, undefined);
  assert.deepEqual(delta.items.map((i) => [i.seq, i.kind, i.tool, i.body]), [[3, 'result', 'Bash', 'a.txt']]);
  // A second watcher gets all of it, and both get what comes next.
  const b = inbox();
  watch.watch('c2', 's1', b.send);
  assert.deepEqual((b[0] as Extract<VisitorsServerMsg, { t: 'visitor.feed' }>).items.map((i) => i.seq), [1, 2, 3]);
  appendFileSync(file, line(assistant([{ type: 'text', text: 'Done.' }])));
  watch.poll();
  assert.equal(a.length, 3);
  assert.equal(b.length, 2);
  assert.deepEqual(watch.counts, { sessions: 1, clients: 2, timer: true });
});

test('watching lets go: of a window that closed, of a socket that went, and of a visitor that left', (t) => {
  const { targets, watch, inbox } = session(t);
  const a = inbox();
  watch.watch('c1', 's1', a.send);
  // Not a visitor the office lists: no feed, only word that it's gone; nothing kept.
  const b = inbox();
  assert.equal(watch.watch('c2', 'not-listed', b.send), false);
  assert.deepEqual([...b], [{ t: 'visitor.gone', id: 'not-listed' }]);
  assert.deepEqual(watch.counts, { sessions: 1, clients: 1, timer: true });
  // A stale unwatch (for a window closed after another opened) changes nothing.
  watch.unwatch('c1', 'other');
  assert.deepEqual(watch.counts, { sessions: 1, clients: 1, timer: true });
  watch.unwatch('c1', 's1');
  assert.deepEqual(watch.counts, { sessions: 0, clients: 0, timer: false });

  // A socket that closes, through the handlers' hooks.
  const ctx = { visitors: { watch } } as any;
  watch.watch('c3', 's1', inbox().send);
  visitorHooks.closed!(ctx, { id: 'c3' } as any);
  assert.deepEqual(watch.counts, { sessions: 0, clients: 0, timer: false });
  // Going to another floor.
  watch.watch('c4', 's1', inbox().send);
  visitorHooks.leaving!(ctx, { id: 'c4' } as any, undefined);
  assert.deepEqual(watch.counts, { sessions: 0, clients: 0, timer: false });

  // Watching another visitor stops watching the first.
  targets.set('s2', targets.get('s1')!);
  watch.watch('c5', 's1', inbox().send);
  watch.watch('c5', 's2', inbox().send);
  assert.deepEqual(watch.counts, { sessions: 1, clients: 1, timer: true });

  // The visitor leaves the office: its watchers are told, and nothing of it stays.
  const c = inbox();
  watch.watch('c6', 's2', c.send);
  targets.delete('s2');
  watch.poll();
  assert.deepEqual(c.at(-1), { t: 'visitor.gone', id: 's2' });
  assert.deepEqual(watch.counts, { sessions: 0, clients: 0, timer: false });
});

test("a watched visitor's subagents each get a tab, read off their own transcripts", (t) => {
  const { file, targets, watch, inbox } = session(t);
  const base = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
  mkdirSync(path.join(base, 'workflows', 'wf1'), { recursive: true });
  writeFileSync(path.join(base, 'agent-a1.jsonl'), line(assistant([use('s1', 'Grep', { pattern: 'price' })], { isSidechain: true })));
  writeFileSync(path.join(base, 'workflows', 'wf1', 'agent-b2.jsonl'), line(assistant([{ type: 'text', text: 'verifying' }], { isSidechain: true })));
  assert.equal(agentFile(file, 'a1'), path.join(base, 'agent-a1.jsonl'));
  assert.equal(agentFile(file, 'b2'), path.join(base, 'workflows', 'wf1', 'agent-b2.jsonl'));
  assert.equal(agentFile(file, '../x'), undefined);
  const sub = (id: string, title: string): Subagent => ({ id, type: 'general-purpose', title, since: 0, seenAt: 0 });
  targets.set('s1', { file, subagents: [sub('a1', 'Find prices'), sub('b2', 'Verify')] });
  const a = inbox();
  watch.watch('c1', 's1', a.send);
  const open = a[0] as Extract<VisitorsServerMsg, { t: 'visitor.feed' }>;
  assert.deepEqual(open.agents, [
    { id: 'a1', type: 'general-purpose', title: 'Find prices', live: true },
    { id: 'b2', type: 'general-purpose', title: 'Verify', live: true },
  ]);
  assert.deepEqual(open.items.filter((i) => i.agent).map((i) => [i.agent, i.head ?? i.body]), [['a1', 'Searching: price'], ['b2', 'verifying']]);
  // One finishes: read a last time, and its tab says so.
  appendFileSync(path.join(base, 'agent-a1.jsonl'), line(assistant([{ type: 'text', text: 'Found 3.' }], { isSidechain: true })));
  targets.set('s1', { file, subagents: [sub('b2', 'Verify')] });
  watch.poll();
  const delta = a[1] as Extract<VisitorsServerMsg, { t: 'visitor.feed' }>;
  assert.deepEqual(delta.items.map((i) => [i.agent, i.body]), [['a1', 'Found 3.']]);
  assert.deepEqual(delta.agents.map((x) => [x.id, x.live]), [['a1', false], ['b2', true]]);
});

test('a watched visitor with many subagents has at most 8 followed, the most recent', (t) => {
  const { file, targets, watch, inbox } = session(t);
  const base = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
  mkdirSync(base, { recursive: true });
  const subs: Subagent[] = Array.from({ length: 10 }, (_, i) => {
    writeFileSync(path.join(base, `agent-s${i}.jsonl`), line(assistant([{ type: 'text', text: `agent ${i}` }], { isSidechain: true })));
    return { id: `s${i}`, type: 'Explore', since: 0, seenAt: 100 - i };
  });
  targets.set('s1', { file, subagents: subs });
  const a = inbox();
  watch.watch('c1', 's1', a.send);
  const open = a[0] as Extract<VisitorsServerMsg, { t: 'visitor.feed' }>;
  assert.deepEqual(open.agents.map((x) => x.id), ['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']);
});
