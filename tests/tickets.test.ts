import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TicketsServerMsg } from '../src/shared/protocol.js';
import { isReviewStage, roleKey, roleName } from '../src/shared/tickets.js';
import { chainLog, frontMatter, goalOf, kindOf, parseApproval, parseTicket, roleSlug, roleTitle, sayOf } from '../src/server/tickets/parse.js';
import { TicketReader, readWorkFile, ticketFiles } from '../src/server/tickets/reader.js';
import { freshest, uniqueDirs } from '../src/server/tickets/source.js';
import { Tickets } from '../src/server/tickets/index.js';

const NOW = Date.UTC(2026, 10, 25, 9);

/** A ticket.md the way the agency writes one: front matter, a goal, a chain log. */
function ticketMd(id: string, o: { status?: string; stage?: string; next?: string; rows?: string[]; goal?: string } = {}) {
  return [
    '---',
    `id: ${id}`,
    'line: carousel',
    'origin: calendar/2026-W48.md#tue',
    `status: ${o.status ?? 'open'}`,
    `stage: ${o.stage ?? 'copy'}`,
    `next_role: ${o.next ?? 'copywriter'}`,
    'assigned_by: creative-director',
    'returns: 0',
    'opened: 2026-11-25',
    '---',
    '',
    '## Goal',
    o.goal ?? 'W48-2: for the resale consultant whose seller\'s price looks high next to a developer\'s',
    'launch price, one carousel that explains the gap.',
    '',
    '## Chain log',
    '| When | Role | Did | Result | Next |',
    '|---|---|---|---|---|',
    ...(o.rows ?? ['| 2026-11-25 03:30 | operations-manager | opened from calendar W48-2 | topic stage | content-strategist |']),
    '',
  ].join('\n');
}

const row = (when: string, role: string, did: string, result: string, next: string) => `| ${when} | ${role} | ${did} | ${result} | ${next} |`;

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'tickets-'));
}

function put(root: string, rel: string, text: string, mtime?: number) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (mtime) utimesSync(file, mtime / 1000, mtime / 1000);
}

test('front matter: the key: value lines between the two ---, quotes taken off, list lines left out', () => {
  const fm = frontMatter('﻿---\r\nid: a\r\nstatus: "open"\r\nnext_role: copywriter\r\nlist:\r\n  - one\r\n---\r\n\r\n## Goal\r\nx');
  assert.deepEqual(fm?.fields, { id: 'a', status: 'open', next_role: 'copywriter', list: '' });
  assert.match(fm!.body, /## Goal/);
  assert.equal(frontMatter('# No front matter\n'), undefined);
  // Never closed: not front matter.
  assert.equal(frontMatter('---\nid: a\nstatus: open\n'), undefined);
});

test("a ticket's goal, and its role names", () => {
  assert.equal(goalOf('## Goal\nShow Omar six `distinct` styles,\neach on a real slide.\n\nMore.\n## Next'), 'Show Omar six distinct styles, each on a real slide.');
  assert.equal(goalOf('## Something else\n'), undefined);
  assert.equal(roleSlug('creative-director: directions: new directions'), 'creative-director');
  assert.equal(roleSlug('`graphic-designer`'), 'graphic-designer');
  assert.equal(roleSlug('none'), undefined);
  assert.equal(roleSlug(''), undefined);
  assert.equal(roleSlug('| -'), undefined);
  assert.equal(roleName('graphic-designer'), 'Graphic Designer');
  assert.equal(roleKey('Graphic Designer'), 'graphic-designer');
  assert.equal(roleKey('graphic-designer'), roleKey(roleName('graphic-designer')));
  assert.equal(roleTitle('# Graphic Designer\n\n`graphic-designer` · Specialist'), 'Graphic Designer');
});

test('the chain log: one row per handoff, the malformed ones skipped', () => {
  const body = [
    '## Goal',
    'x',
    '',
    '## Chain log',
    '| When | Role | Did | Result | Next |',
    '|---|---|---|---|---|',
    row('2026-11-25 04:41', 'copywriter', 'wrote `04-copy.md`', 'copy-review', 'creative-director'),
    '| 2026-11-25 | creative-director | too few cells |',
    row('2026-11-25', '', 'no role', 'stage `x`', 'copywriter'),
    row('2026-11-25', 'Creative Director!', 'not a slug', 'back to copy (return 1 of 2)', 'copywriter'),
    row('2026-11-25', '`creative-director`', 'a slug in backticks', 'back to copy (return 1 of 2)', 'copywriter'),
    '| 2026-11-25 05:20 | graphic-designer | a | b | c in the Did | design-review | creative-director |',
    '| 2026-11-25 05:22 | creative-director | escaped \\| pipe | back to design (return 1 of 2) | graphic-designer |',
    '|---|---|---|---|---|',
    '',
    'Not part of the table.',
    '| 2026-11-25 06:00 | quality-reviewer | after the table | pass | managing-director |',
  ].join('\n');
  const rows = chainLog(body, 't1');
  assert.deepEqual(
    rows.map((r) => [r.role, r.next, r.kind]),
    [
      ['copywriter', 'creative-director', 'review'],
      ['creative-director', 'copywriter', 'return'],
      ['graphic-designer', 'creative-director', 'review'],
      ['creative-director', 'graphic-designer', 'return'],
    ],
  );
  assert.equal(rows[2].did, 'a | b | c in the Did');
  assert.equal(rows[3].did, 'escaped | pipe');
  assert.equal(rows[0].ticket, 't1');
  assert.deepEqual(chainLog('## Goal\nno log here\n', 't'), []);
  // The columns go by the header, whatever order it has them in.
  const swapped = chainLog('## Chain log\n| Role | When | Next | Did | Result |\n|-|-|-|-|-|\n| copywriter | 2026-11-25 | creative-director | wrote it | copy-review |\n', 't');
  assert.deepEqual([swapped[0].role, swapped[0].next, swapped[0].when, swapped[0].kind], ['copywriter', 'creative-director', '2026-11-25', 'review']);
});

test('a return, a review and a handoff', () => {
  for (const r of ['returned, stage `samples` (return 1)', 'back to `directions` (round 3)', 'fail, return 1: 4 numbered changes', 'copy stage, return 1 of 2', 'design stage (return 1): apply both']) assert.equal(kindOf(r), 'return', r);
  for (const r of ['copy-review stage', 'stage `samples-review`', 'approved, quality stage (Facebook page only)', 'pass, stage `md-approval`', 'md-approval; then owner-approval', 'design-review, checking only the two changes']) assert.equal(kindOf(r), 'review', r);
  // Resetting the count to nothing isn't a return, and the owner's approval isn't a review in the chain.
  for (const r of ['quality stage resumes (returns 0)', 'approved, stage `owner-approval` (round 3)', 'publish stage', 'blocked (rule 12): start the image service, then back to design', 'topic stage']) assert.notEqual(kindOf(r), 'return', r);
  assert.equal(kindOf('approved, stage `owner-approval` (round 3)'), 'handoff');
  assert.equal(isReviewStage('copy-review'), true);
  assert.equal(isReviewStage('md-approval'), true);
  assert.equal(isReviewStage('owner-approval'), false);
  assert.equal(isReviewStage('copy'), false);
});

test('what the giver says handing it over, short', () => {
  assert.equal(sayOf('return', 'back to copy', 'copy-review'), 'Back for changes');
  assert.equal(sayOf('handoff', 'approved, Facebook page only', 'copy-review'), 'Copy review ✔');
  assert.equal(sayOf('review', 'approved, quality stage', 'design-review'), 'Design review ✔');
  assert.equal(sayOf('review', 'copy-review stage', 'copy'), 'Copy for review');
  assert.equal(sayOf('review', 'quality stage', 'copy-review'), 'Copy review ✔');
  assert.equal(sayOf('handoff', 'research stage', 'topic'), 'Topic done');
  assert.equal(sayOf('handoff', 'research stage', undefined), 'Over to you');
  assert.ok(sayOf('handoff', 'x', 'a-very-long-stage-name-that-goes-on-and-on').length <= 30);
});

test('a ticket and an approval, as real ones read', () => {
  const t = parseTicket('folder', ticketMd('2026-11-25-carousel-resale-vs-headline', { status: 'Approved', stage: 'Publish', next: 'social-media-manager' }))!;
  assert.equal(t.id, '2026-11-25-carousel-resale-vs-headline');
  assert.equal(t.status, 'approved');
  assert.equal(t.stage, 'publish');
  assert.equal(t.next, 'social-media-manager');
  assert.match(t.title, /^W48-2: for the resale consultant/);
  assert.ok(t.title.length <= 90);
  assert.equal(t.rows.length, 1);
  assert.equal(parseTicket('x', '# just a readme'), undefined);
  // A stage with a note after its name goes by its name.
  assert.equal(parseTicket('x', ticketMd('x', { stage: 'directions (round 5, R20 on CalcRealty)' }))!.stage, 'directions');
  const a = parseApproval('2026-11-23-weekly-planning-W48', '---\nid: 2026-11-23-weekly-planning-W48\nticket: work/2026-11-23-weekly-planning-W48/\nsent: 2026-11-23\ndecision_needed: approve the W48 plan as is, or strike or change entries\n---\n\n# خطة الأسبوع\n');
  assert.deepEqual(a, { id: '2026-11-23-weekly-planning-W48', ticket: '2026-11-23-weekly-planning-W48', sent: '2026-11-23', decision: 'approve the W48 plan as is, or strike or change entries' });
  assert.deepEqual(parseApproval('loose', 'no front matter'), { id: 'loose' });
});

test('a handoff is a new chain-log row: not on the first look, return, review and handoff told apart', () => {
  const root = tmp();
  try {
    const id = '2026-11-25-carousel-resale-vs-headline';
    const rows = [row('2026-11-25 03:30', 'operations-manager', 'opened', 'topic stage', 'content-strategist')];
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy', next: 'copywriter', rows }), NOW - 60_000);
    const reader = new TicketReader(root);
    const first = reader.look(NOW, true);
    assert.equal(first.handoffs.length, 0);
    assert.equal(first.state.on, true);
    assert.deepEqual(first.state.tickets.map((t) => [t.id, t.stage, t.next, t.review]), [[id, 'copy', 'copywriter', false]]);
    // Nothing changed: nothing new.
    assert.equal(reader.look(NOW + 4000, false).handoffs.length, 0);
    // The copywriter hands it in for review.
    rows.push(row('2026-11-25 04:41', 'copywriter', 'wrote `04-copy.md`', 'copy-review stage', 'creative-director'));
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy-review', next: 'creative-director', rows }), NOW + 5000);
    const review = reader.look(NOW + 8000, false);
    assert.deepEqual(
      review.handoffs.map((h) => [h.from, h.to, h.kind, h.stage, h.say]),
      [['copywriter', 'creative-director', 'review', 'copy-review', 'Copy for review']],
    );
    assert.equal(review.handoffs[0].at, NOW + 8000);
    assert.equal(review.state.tickets[0].review, true);
    // The creative director sends it back.
    rows.push(row('2026-11-25 04:50', 'creative-director', 'reviewed', 'back to copy (return 1 of 2)', 'copywriter'));
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy', next: 'copywriter', rows }), NOW + 9000);
    assert.deepEqual(reader.look(NOW + 12000, false).handoffs.map((h) => [h.from, h.to, h.kind, h.say]), [['creative-director', 'copywriter', 'return', 'Back for changes']]);
    // An edit that adds no row (the front matter only) is no handoff.
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy', next: 'copywriter', rows, goal: 'A new goal.' }), NOW + 13000);
    assert.equal(reader.look(NOW + 16000, false).handoffs.length, 0);
    // A ticket opened after the first look hands on its last row only.
    put(root, 'work/2026-11-26-new/ticket.md', ticketMd('2026-11-26-new', { rows: [row('2026-11-26 03:30', 'operations-manager', 'opened', 'topic stage', 'content-strategist')], stage: 'topic', next: 'content-strategist' }), NOW + 17000);
    assert.deepEqual(reader.look(NOW + 20000, false).handoffs.map((h) => [h.ticket, h.from, h.to, h.kind]), [['2026-11-26-new', 'operations-manager', 'content-strategist', 'handoff']]);
    // A row handing to itself (waiting on something) is no handoff.
    rows.push(row('2026-11-25 05:15', 'copywriter', 'waits for the image', 'stage unchanged', 'copywriter'));
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy', next: 'copywriter', rows }), NOW + 21000);
    assert.equal(reader.look(NOW + 24000, false).handoffs.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a file that has not changed is not read again, and a bad one is skipped', () => {
  const root = tmp();
  try {
    const at = NOW - 3600_000;
    put(root, 'work/a/ticket.md', ticketMd('a', { stage: 'copy' }), at);
    put(root, 'work/b/ticket.md', 'not a ticket at all', at);
    put(root, 'work/c/notes.md', 'no ticket.md here', at);
    const reader = new TicketReader(root);
    assert.deepEqual(reader.look(NOW, true).state.tickets.map((t) => t.id), ['a']);
    // Same size, same time, other words: taken as unchanged.
    put(root, 'work/a/ticket.md', ticketMd('a', { stage: 'qopy' }), at);
    assert.equal(reader.look(NOW + 4000, false).state.tickets[0].stage, 'copy');
    // Written again: read again.
    put(root, 'work/a/ticket.md', ticketMd('a', { stage: 'qopy' }), at + 1000);
    assert.equal(reader.look(NOW + 8000, false).state.tickets[0].stage, 'qopy');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('what a floor is sent stays small: the open tickets only, the latest rows, a few approvals', () => {
  const root = tmp();
  try {
    for (let i = 0; i < 60; i++) {
      const id = `2026-11-${String(10 + (i % 15)).padStart(2, '0')}-t${String(i).padStart(2, '0')}`;
      const rows = Array.from({ length: 10 }, (_, r) => row(`2026-11-25 ${String(r).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, 'copywriter', 'x', 'copy-review stage', 'creative-director'));
      put(root, `work/${id}/ticket.md`, ticketMd(id, { status: i < 10 ? 'closed' : 'open', rows }), NOW - (60 - i) * 1000);
    }
    for (let i = 0; i < 30; i++) put(root, `approvals/pending/2026-11-${10 + (i % 15)}-a${i}.md`, `---\nid: a${i}\nsent: 2026-11-${10 + (i % 15)}\ndecision_needed: yes or no\n---\n`);
    put(root, 'roles/copywriter.md', '# Copywriter\n');
    put(root, 'roles/graphic-designer.md', '# Graphic Designer\n');
    const { state } = new TicketReader(root).look(NOW, true);
    assert.equal(state.tickets.length, 40);
    assert.equal(state.more, 10);
    assert.ok(state.tickets.every((t) => t.status === 'open'));
    // The most recently written first.
    assert.equal(state.tickets[0].id.endsWith('t59'), true);
    assert.equal(state.log.length, 12);
    assert.equal(state.approvals.length, 20);
    assert.deepEqual(state.roles, { copywriter: 'Copywriter', 'graphic-designer': 'Graphic Designer' });
    assert.ok(JSON.stringify(state).length < 20_000, `${JSON.stringify(state).length} bytes`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the copy read is the one whose newest ticket was written last; a tie goes to the first listed', () => {
  assert.equal(freshest([{ dir: '/t3', newest: 100 }, { dir: '/main', newest: 300 }, { dir: '/floor', newest: 200 }]), '/main');
  assert.equal(freshest([{ dir: '/visitor', newest: 300 }, { dir: '/floor', newest: 300 }]), '/visitor');
  assert.equal(freshest([{ dir: '/a', newest: 0 }]), undefined);
  assert.equal(freshest([]), undefined);
  assert.deepEqual(uniqueDirs(['/a/b', '/a/b/', '/c', '/a/./b']), ['/a/b', '/c']);
});

test('the office reads the freshest copy, only while someone is on the floor, and says what changed', async () => {
  const floorDir = tmp();
  const visitorDir = tmp();
  try {
    const id = '2026-11-25-style-six-directions';
    const rows = [row('2026-11-25 05:43', 'operations-manager', 'opened', 'line stage', 'managing-director')];
    put(floorDir, `work/${id}/ticket.md`, ticketMd(id, { stage: 'line', next: 'managing-director', rows }), NOW - 3600_000);
    const sent: TicketsServerMsg[] = [];
    let watched = true;
    let folders: string[] = [];
    const tickets = new Tickets({ floors: () => [{ id: 'f', dir: floorDir }], visitorFolders: () => folders, watched: () => watched, send: (_f, m) => void sent.push(m) });
    assert.equal(tickets.state(undefined).on, false);
    await tickets.tick(NOW);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].t === 'tickets' && sent[0].state.tickets[0].stage, 'line');
    // A visitor works in a copy written more lately: that's the one read, from the next pick on, and switching isn't a handoff.
    rows.push(row('2026-11-25 05:45', 'managing-director', 'wrote the line', 'references stage', 'market-research-analyst'));
    put(visitorDir, `work/${id}/ticket.md`, ticketMd(id, { stage: 'references', next: 'market-research-analyst', rows }), NOW);
    folders = [visitorDir];
    await tickets.tick(NOW + 30_000);
    assert.equal(sent.length, 2);
    assert.equal(sent[1].t === 'tickets' && sent[1].state.tickets[0].stage, 'references');
    // Nobody on the floor: no look, and the next look is a first one again.
    watched = false;
    rows.push(row('2026-11-25 06:00', 'market-research-analyst', 'wrote `01-references.md`', 'directions stage', 'creative-director'));
    put(visitorDir, `work/${id}/ticket.md`, ticketMd(id, { stage: 'directions', next: 'creative-director', rows }), NOW + 40_000);
    await tickets.tick(NOW + 44_000);
    assert.equal(sent.length, 2);
    watched = true;
    await tickets.tick(NOW + 48_000);
    assert.deepEqual(sent.slice(2).map((m) => m.t), ['tickets']);
    // Now someone's watching, a new row is a handoff.
    rows.push(row('2026-11-25 06:20', 'creative-director', 'wrote `02-directions.md`', 'samples stage', 'graphic-designer'));
    put(visitorDir, `work/${id}/ticket.md`, ticketMd(id, { stage: 'samples', next: 'graphic-designer', rows }), NOW + 50_000);
    await tickets.tick(NOW + 52_000);
    const handoff = sent.find((m) => m.t === 'tickets.handoff');
    assert.ok(handoff && handoff.t === 'tickets.handoff');
    assert.deepEqual([handoff.handoff.from, handoff.handoff.to, handoff.handoff.say], ['creative-director', 'graphic-designer', 'Directions done']);
    // The window reads only a ticket's own Markdown and the approvals, from the copy read.
    const detail = tickets.ticket('f', id);
    assert.ok(!('error' in detail) && detail.files.some((f) => f.name === 'ticket.md'));
    assert.ok('error' in tickets.ticket('f', '../x'));
    assert.ok('error' in tickets.file('f', `work/${id}/../../../etc/passwd`));
    assert.ok('error' in tickets.file('f', 'package.json'));
    assert.ok(!('error' in tickets.file('f', `work/${id}/ticket.md`)));
    tickets.stop();
  } finally {
    rmSync(floorDir, { recursive: true, force: true });
    rmSync(visitorDir, { recursive: true, force: true });
  }
});

test("a link out of the repository is no way out of it, and only a ticket's Markdown is listed", () => {
  const root = tmp();
  const outside = tmp();
  try {
    put(outside, 'secret.md', 'secret');
    put(root, 'work/a/ticket.md', ticketMd('a'));
    put(root, 'work/a/04-copy.md', '# Copy');
    put(root, 'work/a/design/slides.json', '{}');
    symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'work/a/leak.md'));
    assert.equal(readWorkFile(root, 'work/a/leak.md'), undefined);
    assert.equal(readWorkFile(root, 'work/a/04-copy.md')?.text, '# Copy');
    assert.deepEqual(ticketFiles(root, 'a')?.map((f) => f.name), ['04-copy.md', 'leak.md', 'ticket.md']);
    assert.equal(ticketFiles(root, 'nope'), undefined);
    assert.ok(statSync(path.join(root, 'work/a/ticket.md')).size > 0);
    appendFileSync(path.join(root, 'work/a/ticket.md'), 'x'.repeat(10));
    assert.equal(readWorkFile(root, 'work/a/ticket.md', 20)?.cut, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
