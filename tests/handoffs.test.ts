import test from 'node:test';
import assert from 'node:assert/strict';
import type { Handoff, TicketSummary, Visitor } from '../src/shared/protocol.js';
import { HandoffQueue, isRole, trayFor, visitorFor } from '../src/client/features/handoffs/plan.js';
import { reviewHtml } from '../src/client/features/handoffs/md.js';

test("the review window's Markdown loads nothing: pictures, media and raw HTML come out as text", () => {
  const html = reviewHtml(
    [
      '# A request',
      '',
      '![the six covers](samples/all.png) and ![remote](https://example.com/x.png "t")',
      '',
      '<img src="https://example.com/a.png" srcset="https://example.com/b.png 2x">',
      '',
      '<picture><source srcset="https://example.com/c.webp"><img src="https://example.com/c.png"></picture>',
      '',
      '<video poster="https://example.com/p.png" src="https://example.com/v.mp4"><track src="https://example.com/t.vtt"></video>',
      '',
      'Some <audio src="https://example.com/a.mp3"></audio> inline, and <input type="image" src="https://example.com/i.png">.',
      '',
      '- [x] done',
      '- [ ] not yet',
      '',
      '[a link](https://example.com/page) stays a link.',
    ].join('\n'),
  );
  for (const tag of ['img', 'picture', 'source', 'video', 'audio', 'track', 'input']) assert.doesNotMatch(html, new RegExp(`<${tag}\\b`, 'i'), tag);
  // Written out as text it may say src=, but no tag has one.
  assert.doesNotMatch(html, /<[^>]*\s(srcset|poster|src)=/i);
  assert.match(html, /🖼️ the six covers \(samples\/all\.png\)/);
  assert.match(html, /🖼️ remote \(https:\/\/example\.com\/x\.png\)/);
  assert.match(html, /&lt;video/);
  assert.match(html, /☑ done/);
  assert.match(html, /☐ not yet/);
  assert.match(html, /<a href="https:\/\/example\.com\/page">a link<\/a>/);
});

const visitor = (id: string, title: string, o: Partial<Visitor> = {}): Visitor => ({ id, title, app: 'cli', folder: 'a/b', status: 'working', seenAt: 1, lobby: false, subagents: [], subagentCount: 0, ...o });
const handoff = (from: string, to: string, ticket = 't'): Handoff => ({ ticket, title: ticket, from, to, stage: 's', result: 'r', say: 'x', kind: 'handoff', at: 0 });
const ticket = (id: string, next: string | undefined, review = false): TicketSummary => ({ id, title: id, stage: review ? 'copy-review' : 'copy', status: 'open', ...(next ? { next } : {}), review });

test('a visitor is the session of the role it goes by, by its slug or by the name on its card', () => {
  const roles = { 'md': 'Managing Director' };
  assert.equal(isRole(visitor('a', 'Graphic Designer'), 'graphic-designer', {}), true);
  assert.equal(isRole(visitor('a', 'Managing Director'), 'md', roles), true);
  assert.equal(isRole(visitor('a', 'Fix the hero section'), 'graphic-designer', {}), false);
  const vs = [
    visitor('old', 'Creative Director', { status: 'done', seenAt: 50 }),
    visitor('lobby', 'Creative Director', { lobby: true, seenAt: 90 }),
    visitor('now', 'Creative Director', { seenAt: 10 }),
    visitor('cw', 'Copywriter', { seenAt: 70 }),
  ];
  // One at work before one that's done; never one of another repository.
  assert.equal(visitorFor('creative-director', vs, {})?.id, 'now');
  assert.equal(visitorFor('creative-director', vs.filter((v) => v.id !== 'now'), {})?.id, 'old');
  assert.equal(visitorFor('quality-reviewer', vs, {}), undefined);
});

test("a visitor's in-tray: the open tickets whose next role is its own", () => {
  const ts = [ticket('a', 'copywriter'), ticket('b', 'graphic-designer'), ticket('c', 'copywriter', true), ticket('d', undefined)];
  assert.deepEqual(trayFor(visitor('v', 'Copywriter'), ts, {}).map((t) => t.id), ['a', 'c']);
  assert.deepEqual(trayFor(visitor('v', 'Accountant'), ts, {}), []);
});

test('handoffs run one after another for each giver, and ones that waited too long are dropped', () => {
  const q = new HandoffQueue(120, 5);
  q.push(handoff('copywriter', 'creative-director', 't1'), 0);
  q.push(handoff('copywriter', 'creative-director', 't2'), 1);
  q.push(handoff('graphic-designer', 'quality-reviewer', 't3'), 2);
  const out: string[] = [];
  let busy = new Set<string>();
  const take = (now: number) => {
    const n = q.next(now, (r) => busy.has(r));
    if (n) {
      out.push(n.h.ticket);
      busy = new Set([...busy, n.h.from, n.h.to]);
    }
    return n;
  };
  take(3);
  // The copywriter is out with t1: t2 waits for it, but the designer can go meanwhile.
  take(3);
  assert.deepEqual(out, ['t1', 't3']);
  assert.equal(take(3), undefined);
  busy = new Set();
  take(4);
  assert.deepEqual(out, ['t1', 't3', 't2']);
  // Stale: queued over two minutes ago.
  q.push(handoff('a', 'b', 'old'), 10);
  assert.equal(q.next(200, () => false), undefined);
  assert.equal(q.size, 0);
  // A giver that couldn't go yet goes back to the front, as old as it was.
  q.push(handoff('a', 'b', 'first'), 300);
  q.push(handoff('c', 'd', 'second'), 301);
  const first = q.next(302, () => false)!;
  q.putBack(first.h, first.got);
  assert.equal(q.next(303, () => false)?.h.ticket, 'first');
  assert.equal(q.next(500, () => false), undefined);
  // A burst keeps only the last few.
  for (let i = 0; i < 9; i++) q.push(handoff(`r${i}`, `s${i}`, `b${i}`), 600);
  assert.equal(q.size, 5);
  assert.equal(q.next(600, () => false)?.h.ticket, 'b4');
});
