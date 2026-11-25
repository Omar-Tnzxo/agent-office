import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Subagent, VisitorsServerMsg } from '../src/shared/protocol.js';
import { VisitorWatch, WATCH_BUSY_BYTES, agentFile, fitItems, type WatchTarget } from '../src/server/visitors/watch.js';
import { mayWatch, visitorHandlers, visitorHooks } from '../src/server/ws/handlers/visitors.js';

const line = (e: object) => `${JSON.stringify(e)}\n`;
const assistant = (content: object[], extra: object = {}) => ({ type: 'assistant', message: { model: 'claude-opus-5-5', content, stop_reason: 'tool_use' }, ...extra });
const user = (content: unknown, extra: object = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const use = (id: string, name: string, input: object) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: unknown) => user([{ type: 'tool_result', tool_use_id: id, content }]);
type Feed = Extract<VisitorsServerMsg, { t: 'visitor.feed' }>;

/** A browser's inbox: what it was sent, and how much it has waiting (set by the test). */
function inbox() {
  const got: VisitorsServerMsg[] = [];
  const box = { got, buffered: 0, send: (m: VisitorsServerMsg) => void got.push(m) };
  return Object.assign(box, { watcher: { send: box.send, buffered: () => box.buffered } });
}

/** A session's transcript as Claude Code lays it out, and a watch over it on a clock the test moves. */
function session(t: test.TestContext, opts: { freshPerSecond?: number } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-watch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'proj', '0000-aaaa.jsonl');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, line(user('Start', { cwd: '/w' })) + line(assistant([use('t1', 'Bash', { command: 'ls' })])));
  const targets = new Map<string, WatchTarget>([['s1', { file, subagents: [] }]]);
  const clock = { now: 1_000_000 };
  const watch = new VisitorWatch({ find: (id) => targets.get(id) }, { every: 60_000, now: () => clock.now, ...opts });
  t.after(() => watch.stop());
  return { dir, file, targets, watch, clock };
}

test('watching a visitor: its latest steps on opening, then only what is new, to everyone watching, and never a byte written', (t) => {
  const { file, watch } = session(t);
  const before = { body: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs };
  const a = inbox();
  assert.equal(watch.watch('c1', 's1', a.watcher), 'ok');
  watch.poll();
  assert.deepEqual({ body: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs }, before);
  assert.equal(a.got.length, 1);
  const open = a.got[0] as Feed;
  assert.equal(open.reset, true);
  assert.deepEqual(open.items.map((i) => [i.seq, i.kind, i.head ?? i.body]), [[1, 'prompt', 'Start'], [2, 'tool', '$ ls']]);
  assert.deepEqual(watch.counts, { sessions: 1, idle: 0, clients: 1, timer: true });
  watch.poll();
  assert.equal(a.got.length, 1);
  appendFileSync(file, line(result('t1', 'a.txt')));
  watch.poll();
  const delta = a.got[1] as Feed;
  assert.equal(delta.reset, undefined);
  assert.deepEqual(delta.items.map((i) => [i.seq, i.kind, i.tool, i.body]), [[3, 'result', 'Bash', 'a.txt']]);
  const b = inbox();
  watch.watch('c2', 's1', b.watcher);
  assert.deepEqual((b.got[0] as Feed).items.map((i) => i.seq), [1, 2, 3]);
  appendFileSync(file, line(assistant([{ type: 'text', text: 'Done.' }])));
  watch.poll();
  assert.equal(a.got.length, 3);
  assert.equal(b.got.length, 2);
});

test('asking again for the visitor you watch does nothing, and one you just left is kept a little while', (t) => {
  const { file, targets, watch, clock } = session(t);
  targets.set('s2', { file, subagents: [] });
  const a = inbox();
  watch.watch('c1', 's1', a.watcher);
  assert.equal(watch.watch('c1', 's1', a.watcher), 'same');
  assert.equal(a.got.length, 1);
  // A, B, A: back to A within the grace period reuses what was read of it.
  watch.watch('c1', 's2', a.watcher);
  assert.deepEqual(watch.counts, { sessions: 2, idle: 1, clients: 1, timer: true });
  clock.now += 3000;
  watch.poll();
  assert.equal(watch.watch('c1', 's1', a.watcher), 'ok');
  const back = a.got.at(-1) as Feed;
  assert.equal(back.reset, true);
  // The same items, same numbers: nothing was read again from the start.
  assert.deepEqual(back.items.map((i) => i.seq), [1, 2]);
  // B, left alone past the grace period, is let go of.
  assert.deepEqual(watch.counts, { sessions: 2, idle: 1, clients: 1, timer: true });
  clock.now += 9000;
  watch.poll();
  assert.equal(watch.counts.sessions, 2);
  clock.now += 1001;
  watch.poll();
  assert.deepEqual(watch.counts, { sessions: 1, idle: 0, clients: 1, timer: true });
  // And the timer stops with the last one.
  watch.unwatch('c1');
  assert.deepEqual(watch.counts, { sessions: 1, idle: 1, clients: 0, timer: true });
  clock.now += 10_000;
  watch.poll();
  assert.deepEqual(watch.counts, { sessions: 0, idle: 0, clients: 0, timer: false });
});

test('only a few sessions a second are opened afresh, across the office', (t) => {
  const { file, targets, watch, clock } = session(t, { freshPerSecond: 2 });
  for (const id of ['s2', 's3']) targets.set(id, { file, subagents: [] });
  assert.equal(watch.watch('c1', 's1', inbox().watcher), 'ok');
  assert.equal(watch.watch('c2', 's2', inbox().watcher), 'ok');
  assert.equal(watch.watch('c3', 's3', inbox().watcher), 'busy');
  // One already open costs nothing.
  assert.equal(watch.watch('c4', 's1', inbox().watcher), 'ok');
  clock.now += 1001;
  assert.equal(watch.watch('c3', 's3', inbox().watcher), 'ok');
});

test('a transcript rewritten, or replaced by another file, is sent again whole, as a reset', (t) => {
  const { file, watch } = session(t);
  const a = inbox();
  watch.watch('c1', 's1', a.watcher);
  // Shorter: rewritten in place.
  writeFileSync(file, line(user('Again')));
  watch.poll();
  const shrunk = a.got.at(-1) as Feed;
  assert.equal(shrunk.reset, true);
  assert.deepEqual(shrunk.items.map((i) => i.body), ['Again']);
  // Another file in its place (a new inode), even a longer one.
  const other = `${file}.new`;
  writeFileSync(other, line(user('Third')) + line(assistant([use('x', 'Read', { file_path: '/w/a.md' })])) + line(assistant([{ type: 'text', text: 'padding '.repeat(20) }])));
  renameSync(other, file);
  watch.poll();
  const replaced = a.got.at(-1) as Feed;
  assert.equal(replaced.reset, true);
  assert.deepEqual(replaced.items.map((i) => i.kind), ['prompt', 'tool', 'text']);
  assert.equal(replaced.items[0].body, 'Third');
});

test('a browser that has fallen behind gets nothing new until it catches up, and then all of it', (t) => {
  const { file, watch } = session(t);
  const a = inbox();
  watch.watch('c1', 's1', a.watcher);
  a.buffered = WATCH_BUSY_BYTES + 1;
  appendFileSync(file, line(result('t1', 'one')));
  watch.poll();
  appendFileSync(file, line(assistant([{ type: 'text', text: 'two' }])));
  watch.poll();
  assert.equal(a.got.length, 1);
  a.buffered = 0;
  watch.poll();
  const caught = a.got.at(-1) as Feed;
  assert.equal(caught.reset, true);
  assert.deepEqual(caught.items.map((i) => i.seq), [1, 2, 3, 4]);
  // A message never goes past its size: the oldest items go first.
  const items = Array.from({ length: 10 }, (_, i) => ({ seq: i, kind: 'text' as const, body: 'x'.repeat(100) }));
  // Each is 134 characters of JSON, and a separator: five fit in 700.
  const fitted = fitItems(items, 700);
  assert.equal(fitted.all, false);
  assert.deepEqual(fitted.items.map((i) => i.seq), [5, 6, 7, 8, 9]);
});

test('watching lets go: of a window that closed, of a socket that went, of one who may no longer, and of a visitor that left', (t) => {
  const { targets, watch } = session(t);
  const b = inbox();
  assert.equal(watch.watch('c2', 'not-listed', b.watcher), 'gone');
  assert.deepEqual(b.got, [{ t: 'visitor.gone', id: 'not-listed' }]);
  assert.equal(watch.counts.sessions, 0);
  watch.watch('c1', 's1', inbox().watcher);
  watch.unwatch('c1', 'other');
  assert.equal(watch.counts.clients, 1);
  watch.unwatch('c1', 's1');
  assert.equal(watch.counts.clients, 0);

  const ctx = { visitors: { watch } } as any;
  watch.watch('c3', 's1', inbox().watcher);
  visitorHooks.closed!(ctx, { id: 'c3' } as any);
  assert.equal(watch.counts.clients, 0);
  watch.watch('c4', 's1', inbox().watcher);
  visitorHooks.leaving!(ctx, { id: 'c4' } as any, undefined);
  assert.equal(watch.counts.clients, 0);

  // One who may no longer watch (demoted, or on another floor now) is told it's over.
  let may = true;
  const d = inbox();
  watch.watch('c5', 's1', { ...d.watcher, may: () => may });
  may = false;
  watch.poll();
  assert.deepEqual(d.got.at(-1), { t: 'visitor.gone', id: 's1' });
  assert.equal(watch.counts.clients, 0);

  const c = inbox();
  watch.watch('c6', 's1', c.watcher);
  targets.delete('s1');
  watch.poll();
  assert.deepEqual(c.got.at(-1), { t: 'visitor.gone', id: 's1' });
  assert.deepEqual(watch.counts, { sessions: 0, idle: 0, clients: 0, timer: false });
});

/** A context with one floor and one listed visitor on it, for the handlers. */
function office(watch: VisitorWatch, opts: { admin: boolean; floor: string | undefined }) {
  const sent: VisitorsServerMsg[] = [];
  const warned: string[] = [];
  const lists: Record<string, { visitors: { id: string }[] }> = { f1: { visitors: [{ id: 's1' }] }, f2: { visitors: [] } };
  const ctx = {
    meOf: () => ({ admin: opts.admin }),
    floorOf: () => (opts.floor ? { id: opts.floor } : undefined),
    visitors: { watch, state: (f: string | undefined) => (f && lists[f]) || { visitors: [] } },
    sendTo: (_c: unknown, m: VisitorsServerMsg) => sent.push(m),
    warn: (_c: unknown, text: string) => warned.push(text),
  } as any;
  const c = { id: 'c1', accountId: 'acc', ws: { bufferedAmount: 0 }, throttles: new Map() } as any;
  return { ctx, c, sent, warned, opts };
}

test('only an admin on the floor a visitor is listed on may watch it', (t) => {
  const { watch } = session(t);
  // Not an admin: turned away, and nothing is opened.
  const member = office(watch, { admin: false, floor: 'f1' });
  visitorHandlers['visitor.watch'](member.ctx, member.c, { t: 'visitor.watch', id: 's1' });
  assert.deepEqual(member.sent, []);
  assert.deepEqual(member.warned, ['Only admins can watch a visitor']);
  assert.equal(watch.counts.sessions, 0);
  // An admin on another floor: as if it weren't there.
  const elsewhere = office(watch, { admin: true, floor: 'f2' });
  visitorHandlers['visitor.watch'](elsewhere.ctx, elsewhere.c, { t: 'visitor.watch', id: 's1' });
  assert.deepEqual(elsewhere.sent, [{ t: 'visitor.gone', id: 's1' }]);
  assert.equal(watch.counts.sessions, 0);
  assert.equal(mayWatch(office(watch, { admin: true, floor: undefined }).ctx, elsewhere.c, 's1'), false);
  // An admin on its floor: the feed; then gone to another floor, it stops at the next look.
  const admin = office(watch, { admin: true, floor: 'f1' });
  visitorHandlers['visitor.watch'](admin.ctx, admin.c, { t: 'visitor.watch', id: 's1' });
  assert.equal((admin.sent[0] as Feed).reset, true);
  admin.opts.floor = 'f2';
  watch.poll();
  assert.deepEqual(admin.sent.at(-1), { t: 'visitor.gone', id: 's1' });
  assert.equal(watch.counts.clients, 0);
});

test("a watched visitor's subagents each get a tab; at most 8 are followed, and one let go of goes on from where it stopped", (t) => {
  const { file, targets, watch } = session(t);
  const base = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
  mkdirSync(path.join(base, 'workflows', 'wf1'), { recursive: true });
  writeFileSync(path.join(base, 'agent-a1.jsonl'), line(assistant([use('s1', 'Grep', { pattern: 'price' })], { isSidechain: true })));
  writeFileSync(path.join(base, 'workflows', 'wf1', 'agent-b2.jsonl'), line(assistant([{ type: 'text', text: 'verifying' }], { isSidechain: true })));
  assert.equal(agentFile(file, 'a1'), path.join(base, 'agent-a1.jsonl'));
  assert.equal(agentFile(file, 'b2'), path.join(base, 'workflows', 'wf1', 'agent-b2.jsonl'));
  assert.equal(agentFile(file, '../x'), undefined);
  const sub = (id: string, title?: string, seenAt = 0): Subagent => ({ id, type: 'general-purpose', ...(title ? { title } : {}), since: 0, seenAt });
  targets.set('s1', { file, subagents: [sub('a1', 'Find prices'), sub('b2', 'Verify')] });
  const a = inbox();
  watch.watch('c1', 's1', a.watcher);
  const open = a.got[0] as Feed;
  assert.deepEqual(open.agents, [
    { id: 'a1', type: 'general-purpose', title: 'Find prices', live: true },
    { id: 'b2', type: 'general-purpose', title: 'Verify', live: true },
  ]);
  assert.deepEqual(open.items.filter((i) => i.agent).map((i) => [i.agent, i.head ?? i.body]), [['a1', 'Searching: price'], ['b2', 'verifying']]);
  appendFileSync(path.join(base, 'agent-a1.jsonl'), line(assistant([{ type: 'text', text: 'Found 3.' }], { isSidechain: true })));
  targets.set('s1', { file, subagents: [sub('b2', 'Verify')] });
  watch.poll();
  const delta = a.got[1] as Feed;
  assert.deepEqual(delta.items.map((i) => [i.agent, i.body]), [['a1', 'Found 3.']]);
  assert.deepEqual(delta.agents.map((x) => [x.id, x.live]), [['a1', false], ['b2', true]]);

  // Eight more at work: the finished a1 makes room, and only 8 are followed.
  const many = Array.from({ length: 9 }, (_, i) => {
    writeFileSync(path.join(base, `agent-m${i}.jsonl`), line(assistant([{ type: 'text', text: `m${i}` }], { isSidechain: true })));
    return sub(`m${i}`, undefined, 100 - i);
  });
  targets.set('s1', { file, subagents: [sub('b2', 'Verify', 200), ...many] });
  watch.poll();
  const crowd = (a.got.at(-1) as Feed).agents.map((x) => x.id);
  assert.equal(crowd.length, 8);
  assert.ok(!crowd.includes('a1'));
  // a1 comes back with something new: only that is read, not its start again.
  appendFileSync(path.join(base, 'agent-a1.jsonl'), line(assistant([{ type: 'text', text: 'Back.' }], { isSidechain: true })));
  targets.set('s1', { file, subagents: [sub('a1', 'Find prices', 300), ...many.slice(0, 2)] });
  watch.poll();
  watch.poll();
  const back = a.got.flatMap((m) => (m.t === 'visitor.feed' ? m.items : [])).filter((i) => i.agent === 'a1').map((i) => i.body ?? i.head);
  assert.deepEqual(back, ['Searching: price', 'Found 3.', 'Back.']);
});
