import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Handoff, TicketsServerMsg, TicketsState } from '../src/shared/protocol.js';
import { isReviewStage, roleKey, roleName } from '../src/shared/tickets.js';
import { chainLog, frontMatter, goalOf, kindOf, parseApproval, parseTicket, roleSlug, roleTitle, sayOf, stageIn } from '../src/server/tickets/parse.js';
import { CopyReader, newestTicket, readWorkFile, ticketFiles } from '../src/server/tickets/reader.js';
import { Seen } from '../src/server/tickets/seen.js';
import { copiesToRead, uniqueDirs } from '../src/server/tickets/source.js';
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
    o.goal ?? "W48-2: for the resale consultant whose seller's price looks high next to a developer's",
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

/** An office watching one floor whose checkout is `dir`, its visitors working in `folders()`; `tick(t)` looks once and says what the floor was sent. */
function office(dir: string, folders: () => string[] = () => []) {
  let watched = true;
  let sent: TicketsServerMsg[] = [];
  let state: TicketsState | undefined;
  const tickets = new Tickets({ floors: () => [{ id: 'f', dir }], visitorFolders: folders, watched: () => watched, send: (_f, m) => void (m.t === 'tickets' ? (state = m.state) : sent.push(m)) });
  return {
    tickets,
    state: () => state,
    watch: (on: boolean) => void (watched = on),
    async tick(t: number): Promise<Handoff[]> {
      sent = [];
      await tickets.tick(t);
      return sent.flatMap((m) => (m.t === 'tickets.handoff' ? [m.handoff] : []));
    },
  };
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

test('real rows the agency wrote: a missing Next cell, "no change of stage", a Next that is no role', () => {
  const body = [
    '## Chain log',
    '| When | Role | Did | Result | Next |',
    '|---|---|---|---|---|',
    // The first-run ticket, 2026-11-25 05:00: four cells, its Next never written.
    '| 2026-11-25 05:00 | account-manager | owner-approval, Facebook page only: wrote `approvals/pending/2026-11-23-carousel-first-run.md` | waiting-owner at publish; on his yes the account-manager files it and routes to social-media-manager |',
    // The style ticket, 2026-11-25 07:15.
    row('2026-11-25 07:15', 'account-manager', "Omar's request: the references as pictures", "no change of stage: the graphic-designer's round 3 samples go on", "graphic-designer (unchanged); if Omar names references by number, the creative-director takes them into `directions`"),
  ].join('\n');
  const rows = chainLog(body, 't');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].role, 'account-manager');
  assert.equal(rows[0].next, undefined);
  assert.match(rows[0].result, /^waiting-owner at publish/);
  assert.equal(rows[1].same, true);
  assert.equal(stageIn("no change of stage: the graphic-designer's round 3 samples go on"), undefined);
  assert.equal(stageIn('the same stage, then copy-review'), 'copy-review');
  assert.equal(kindOf("no change of stage: the graphic-designer's round 3 samples go on"), 'handoff');
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
  // Its rows go by its folder, not the id its front matter gives.
  assert.equal(t.rows[0].ticket, 'folder');
  assert.equal(parseTicket('x', '# just a readme'), undefined);
  // A stage with a note after its name goes by its name.
  assert.equal(parseTicket('x', ticketMd('x', { stage: 'directions (round 5, R20 on CalcRealty)' }))!.stage, 'directions');
  const a = parseApproval('2026-11-23-weekly-planning-W48', '---\nid: 2026-11-23-weekly-planning-W48\nticket: work/2026-11-23-weekly-planning-W48/\nsent: 2026-11-23\ndecision_needed: approve the W48 plan as is, or strike or change entries\n---\n\n# خطة الأسبوع\n');
  assert.deepEqual(a, { id: '2026-11-23-weekly-planning-W48', ticket: '2026-11-23-weekly-planning-W48', sent: '2026-11-23', decision: 'approve the W48 plan as is, or strike or change entries' });
  assert.deepEqual(parseApproval('loose', 'no front matter'), { id: 'loose' });
});

test('a handoff is a new chain-log row: not on the first look, return, review and handoff told apart', async () => {
  const root = tmp();
  try {
    const id = '2026-11-25-carousel-resale-vs-headline';
    const rows = [row('2026-11-25 03:30', 'operations-manager', 'opened', 'topic stage', 'content-strategist')];
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy', next: 'copywriter', rows }), NOW - 60_000);
    const o = office(root);
    assert.equal((await o.tick(NOW)).length, 0);
    assert.equal(o.state()?.on, true);
    assert.deepEqual(o.state()?.tickets.map((t) => [t.folder, t.stage, t.next, t.review]), [[id, 'copy', 'copywriter', false]]);
    assert.equal((await o.tick(NOW + 4000)).length, 0);
    rows.push(row('2026-11-25 04:41', 'copywriter', 'wrote `04-copy.md`', 'copy-review stage', 'creative-director'));
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy-review', next: 'creative-director', rows }), NOW + 5000);
    const review = await o.tick(NOW + 8000);
    assert.deepEqual(review.map((h) => [h.ticket, h.from, h.to, h.kind, h.stage, h.say]), [[id, 'copywriter', 'creative-director', 'review', 'copy-review', 'Copy for review']]);
    assert.equal(review[0].at, NOW + 8000);
    rows.push(row('2026-11-25 04:50', 'creative-director', 'reviewed', 'back to copy (return 1 of 2)', 'copywriter'));
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy', next: 'copywriter', rows }), NOW + 9000);
    assert.deepEqual((await o.tick(NOW + 12000)).map((h) => [h.from, h.to, h.kind, h.say]), [['creative-director', 'copywriter', 'return', 'Back for changes']]);
    // An edit that adds no row is no handoff.
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy', next: 'copywriter', rows, goal: 'A new goal.' }), NOW + 13000);
    assert.equal((await o.tick(NOW + 16000)).length, 0);
    // A ticket opened after the first look hands on its last row only.
    put(root, 'work/2026-11-26-new/ticket.md', ticketMd('2026-11-26-new', { rows: [row('2026-11-26 03:30', 'operations-manager', 'opened', 'topic stage', 'content-strategist')], stage: 'topic', next: 'content-strategist' }), NOW + 17000);
    assert.deepEqual((await o.tick(NOW + 20000)).map((h) => [h.ticket, h.from, h.to]), [['2026-11-26-new', 'operations-manager', 'content-strategist']]);
    // Handing it to itself, or leaving it as it was, is no handoff.
    rows.push(row('2026-11-25 05:15', 'copywriter', 'waits for the image', 'stage unchanged', 'copywriter'));
    rows.push(row('2026-11-25 05:16', 'account-manager', 'filed his words', 'no change of stage: the samples go on', 'graphic-designer (unchanged)'));
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy', next: 'copywriter', rows }), NOW + 21000);
    assert.equal((await o.tick(NOW + 24000)).length, 0);
    // Nobody on the floor: nothing looked at, and what was written meanwhile isn't played back later.
    o.watch(false);
    rows.push(row('2026-11-25 05:30', 'copywriter', 'wrote it', 'copy-review stage', 'creative-director'));
    put(root, `work/${id}/ticket.md`, ticketMd(id, { stage: 'copy-review', next: 'creative-director', rows }), NOW + 25000);
    assert.equal((await o.tick(NOW + 28000)).length, 0);
    o.watch(true);
    assert.equal((await o.tick(NOW + 32000)).length, 0);
    o.tickets.stop();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no replays: rows that go and come back, a half-written file, a malformed row fixed later', async () => {
  const root = tmp();
  try {
    const id = 't1';
    const base = [row('2026-11-25 03:30', 'operations-manager', 'opened', 'topic stage', 'content-strategist'), row('2026-11-25 03:40', 'content-strategist', 'wrote the topic', 'research stage', 'market-research-analyst')];
    const broken = '| 2026-11-25 03:50 | market-research-analyst | a row written wrong |';
    const fixed = row('2026-11-25 03:50', 'market-research-analyst', 'a row written right', 'brief stage', 'creative-director');
    const later = row('2026-11-25 04:00', 'creative-director', 'wrote the brief', 'copy stage', 'copywriter');
    let t = NOW;
    const write = (rows: string[], text?: string) => put(root, `work/${id}/ticket.md`, text ?? ticketMd(id, { rows }), (t += 1000));
    write([...base, broken, later]);
    const o = office(root);
    assert.equal((await o.tick((t += 4000))).length, 0);
    // A branch checked out behind it: rows drop. Then back again: none of them is new.
    write(base.slice(0, 1));
    assert.equal((await o.tick((t += 4000))).length, 0);
    write([...base, broken, later]);
    assert.equal((await o.tick((t += 4000))).length, 0);
    // Half written: no front matter at all for a moment, then cut off half way through its log.
    write([], '---\nid: t1\nstat');
    assert.equal((await o.tick((t += 4000))).length, 0);
    assert.equal(o.state()?.tickets.length, 1, 'kept as it last read while it can not be read');
    write(base.slice(0, 1));
    assert.equal((await o.tick((t += 4000))).length, 0);
    write([...base, broken, later]);
    assert.equal((await o.tick((t += 4000))).length, 0);
    // The malformed row fixed: noted, not a handoff, being earlier than the last row seen.
    write([...base, fixed, later]);
    assert.equal((await o.tick((t += 4000))).length, 0);
    // A row really new after all that still is one.
    write([...base, fixed, later, row('2026-11-25 04:10', 'copywriter', 'wrote the copy', 'copy-review stage', 'creative-director')]);
    assert.deepEqual((await o.tick((t += 4000))).map((h) => h.from), ['copywriter']);
    o.tickets.stop();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the rows seen of a ticket stay bounded, and a log rewritten under it is no burst of handoffs', () => {
  const seen = new Seen({ prints: 5, tickets: 2, gone: 1000 });
  assert.deepEqual(seen.take('a', ['1', '2', '3'], 3, true, true), []);
  assert.deepEqual(seen.take('a', ['1', '2', '3', '4'], 4, false, true), [3]);
  // Every row different: a rewritten log, noted only.
  assert.deepEqual(seen.take('a', ['x', 'y', 'z', 'w', 'v'], 5, false, true), []);
  // The oldest prints go first, past the limit.
  assert.deepEqual(seen.take('a', ['v', 'n'], 6, false, true), [1]);
  // A ticket new after the first look hands on its last row; on a quiet look, nothing.
  assert.deepEqual(seen.take('b', ['p', 'q'], 2, false, true), [1]);
  assert.deepEqual(seen.take('c', ['r'], 1, true, true), []);
  // Past the tickets limit, the gone ones go first.
  seen.keep(new Set(['a', 'c']), 0);
  assert.equal(seen.size, 2);
});

test('two copies of the repository: each row is sent once, and a stale checkout never wins', async () => {
  const floorDir = tmp();
  const visitorDir = tmp();
  try {
    const id = '2026-11-25-style-six-directions';
    const rows = [row('2026-11-25 05:43', 'operations-manager', 'opened', 'line stage', 'managing-director')];
    put(floorDir, `work/${id}/ticket.md`, ticketMd(id, { stage: 'line', next: 'managing-director', rows }), NOW - 3600_000);
    let folders: string[] = [];
    const o = office(floorDir, () => folders);
    assert.equal(o.tickets.state(undefined).on, false);
    await o.tick(NOW);
    assert.equal(o.state()?.tickets[0].stage, 'line');
    // A visitor works in a copy further along: from the next pick on it's read too, and what it already had isn't news.
    rows.push(row('2026-11-25 05:45', 'managing-director', 'wrote the line', 'references stage', 'market-research-analyst'));
    put(visitorDir, `work/${id}/ticket.md`, ticketMd(id, { stage: 'references', next: 'market-research-analyst', rows }), NOW);
    folders = [visitorDir];
    assert.equal((await o.tick(NOW + 30_000)).length, 0);
    assert.equal(o.state()?.tickets[0].stage, 'references');
    // A new row in the visitor's copy is a handoff once; the same row reaching the floor's checkout later isn't.
    rows.push(row('2026-11-25 06:00', 'market-research-analyst', 'wrote `01-references.md`', 'directions stage', 'creative-director'));
    put(visitorDir, `work/${id}/ticket.md`, ticketMd(id, { stage: 'directions', next: 'creative-director', rows }), NOW + 31_000);
    assert.deepEqual((await o.tick(NOW + 34_000)).map((h) => [h.from, h.to, h.say]), [['market-research-analyst', 'creative-director', 'References done']]);
    put(floorDir, `work/${id}/ticket.md`, ticketMd(id, { stage: 'directions', next: 'creative-director', rows }), NOW + 35_000);
    assert.equal((await o.tick(NOW + 38_000)).length, 0);
    // An old branch checked out in the floor's checkout: its file is the newest written, but its log is shorter, and it loses.
    put(floorDir, `work/${id}/ticket.md`, ticketMd(id, { stage: 'line', next: 'managing-director', rows: rows.slice(0, 1) }), NOW + 60_000);
    assert.equal((await o.tick(NOW + 62_000)).length, 0);
    assert.equal(o.state()?.tickets[0].stage, 'directions');
    // The window reads a ticket from the copy that won, and only a ticket's own Markdown and the approvals.
    const detail = o.tickets.ticket('f', id);
    assert.ok(!('error' in detail) && detail.text.includes('stage: directions'));
    assert.ok('error' in o.tickets.ticket('f', '../x'));
    assert.ok('error' in o.tickets.file('f', `work/${id}/../../../etc/passwd`));
    assert.ok('error' in o.tickets.file('f', 'package.json'));
    assert.ok(!('error' in o.tickets.file('f', `work/${id}/ticket.md`)));
    o.tickets.stop();
  } finally {
    rmSync(floorDir, { recursive: true, force: true });
    rmSync(visitorDir, { recursive: true, force: true });
  }
});

test('a handoff only goes to a role the repository has a card for', async () => {
  const root = tmp();
  try {
    put(root, 'roles/copywriter.md', '# Copywriter\n');
    put(root, 'roles/social-media-manager.md', '# Social Media Manager\n');
    const rows = [row('2026-11-25 03:30', 'operations-manager', 'opened', 'topic stage', 'copywriter')];
    put(root, 'work/t/ticket.md', ticketMd('t', { rows }), NOW);
    const o = office(root);
    await o.tick(NOW + 1000);
    rows.push('| 2026-11-25 05:00 | copywriter | wrote it | waiting-owner at publish; on his yes it goes to social-media-manager |');
    put(root, 'work/t/ticket.md', ticketMd('t', { rows, next: 'waiting-owner' }), NOW + 2000);
    assert.equal((await o.tick(NOW + 5000)).length, 0, 'waiting-owner is no role');
    rows.push(row('2026-11-25 05:10', 'copywriter', 'wrote it again', 'publish stage', 'social-media-manager'));
    put(root, 'work/t/ticket.md', ticketMd('t', { rows, next: 'social-media-manager' }), NOW + 6000);
    assert.deepEqual((await o.tick(NOW + 9000)).map((h) => h.to), ['social-media-manager']);
    assert.deepEqual(o.state()?.roles, { copywriter: 'Copywriter', 'social-media-manager': 'Social Media Manager' });
    o.tickets.stop();
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
    const reader = new CopyReader(root);
    assert.deepEqual(reader.look(NOW), ['a']);
    put(root, 'work/a/ticket.md', ticketMd('a', { stage: 'qopy' }), at);
    assert.deepEqual(reader.look(NOW + 4000), []);
    assert.equal(reader.tickets.get('a')?.summary.stage, 'copy');
    put(root, 'work/a/ticket.md', ticketMd('a', { stage: 'qopy' }), at + 1000);
    assert.deepEqual(reader.look(NOW + 8000), ['a']);
    assert.equal(reader.tickets.get('a')?.summary.stage, 'qopy');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('what a floor is sent stays small, and its latest rows are in the order they were written', async () => {
  const root = tmp();
  try {
    for (let i = 0; i < 60; i++) {
      const id = `2026-11-${String(10 + (i % 15)).padStart(2, '0')}-t${String(i).padStart(2, '0')}`;
      const rows = Array.from({ length: 10 }, (_, r) => row(`2026-11-25 ${String(r).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`, 'copywriter', `row ${r}`, 'copy-review stage', 'creative-director'));
      put(root, `work/${id}/ticket.md`, ticketMd(id, { status: i < 10 ? 'closed' : 'open', rows }), NOW - (60 - i) * 1000);
    }
    // Written out of time order, the way real tickets append: the file's order wins.
    put(root, 'work/z/ticket.md', ticketMd('z', { rows: [row('2026-11-25 07:00', 'copywriter', 'first', 'x', 'creative-director'), row('2026-11-25 06:27', 'managing-director', 'second', 'y', 'copywriter')] }), NOW + 1000);
    for (let i = 0; i < 30; i++) put(root, `approvals/pending/2026-11-${10 + (i % 15)}-a${i}.md`, `---\nid: a${i}\nsent: 2026-11-${10 + (i % 15)}\ndecision_needed: yes or no\n---\n`);
    put(root, 'roles/copywriter.md', '# Copywriter\n');
    put(root, 'roles/graphic-designer.md', '# Graphic Designer\n');
    const o = office(root);
    await o.tick(NOW + 2000);
    const state = o.state()!;
    assert.equal(state.tickets.length, 40);
    assert.equal(state.more, 11);
    assert.ok(state.tickets.every((t) => t.status === 'open'));
    assert.equal(state.tickets[0].folder, 'z');
    assert.equal(state.log.length, 12);
    assert.deepEqual(state.log.slice(0, 2).map((r) => r.did), ['second', 'first']);
    assert.equal(state.approvals.length, 20);
    assert.deepEqual(state.roles, { copywriter: 'Copywriter', 'graphic-designer': 'Graphic Designer' });
    assert.ok(JSON.stringify(state).length < 20_000, `${JSON.stringify(state).length} bytes`);
    o.tickets.stop();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the copies read: the ones with tickets, newest first, at most six; only the latest folders are stat\'ed for it', () => {
  assert.deepEqual(copiesToRead([{ dir: '/t3', newest: 100 }, { dir: '/main', newest: 300 }, { dir: '/floor', newest: 200 }]), ['/main', '/floor', '/t3']);
  assert.deepEqual(copiesToRead([{ dir: '/visitor', newest: 300 }, { dir: '/floor', newest: 300 }, { dir: '/none', newest: 0 }]), ['/visitor', '/floor']);
  assert.equal(copiesToRead(Array.from({ length: 9 }, (_, i) => ({ dir: `/c${i}`, newest: i + 1 }))).length, 6);
  assert.deepEqual(uniqueDirs(['/a/b', '/a/b/', '/c', '/a/./b']), ['/a/b', '/c']);
  const root = tmp();
  try {
    put(root, 'work/2026-01-01-old/ticket.md', ticketMd('old'), NOW + 5000);
    for (let i = 0; i < 50; i++) put(root, `work/2026-11-${String(i).padStart(2, '0')}-t/ticket.md`, ticketMd('t'), NOW);
    // The oldest folder by name, written last, is past the last 50 and isn't stat'ed.
    assert.equal(newestTicket(root), NOW);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a link is never followed: not by the window, not by the office reading the tickets', () => {
  const root = tmp();
  const outside = tmp();
  try {
    put(outside, 'secret.md', 'secret');
    put(outside, 'ticket.md', ticketMd('outside'));
    put(outside, 'elsewhere/ticket.md', ticketMd('elsewhere'));
    put(outside, 'roles/spy.md', '# Spy\n');
    put(root, 'work/a/ticket.md', ticketMd('a'));
    put(root, 'work/a/04-copy.md', '# Copy');
    put(root, 'work/a/design/slides.json', '{}');
    symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'work/a/leak.md'));
    // A ticket.md that's a link, a ticket folder that's a link, and a roles folder that's a link.
    mkdirSync(path.join(root, 'work/b'));
    symlinkSync(path.join(outside, 'ticket.md'), path.join(root, 'work/b/ticket.md'));
    symlinkSync(path.join(outside, 'elsewhere'), path.join(root, 'work/c'));
    symlinkSync(path.join(outside, 'roles'), path.join(root, 'roles'));
    symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'approvals-link.md'));
    const reader = new CopyReader(root);
    assert.deepEqual(reader.look(NOW), ['a']);
    assert.deepEqual(reader.roles(), {});
    assert.equal(readWorkFile(root, 'work/a/leak.md'), undefined);
    assert.equal(readWorkFile(root, 'work/a/04-copy.md')?.text, '# Copy');
    assert.deepEqual(ticketFiles(root, 'a')?.map((f) => f.name), ['04-copy.md', 'ticket.md']);
    assert.equal(ticketFiles(root, 'b'), undefined);
    assert.equal(ticketFiles(root, 'c'), undefined);
    assert.equal(ticketFiles(root, 'nope'), undefined);
    assert.ok(statSync(path.join(root, 'work/a/ticket.md')).size > 0);
    appendFileSync(path.join(root, 'work/a/ticket.md'), 'x'.repeat(10));
    assert.equal(readWorkFile(root, 'work/a/ticket.md', 20)?.cut, true);
    // A work folder that is itself a link reads as none.
    const linked = tmp();
    symlinkSync(path.join(root, 'work'), path.join(linked, 'work'));
    assert.deepEqual(new CopyReader(linked).look(NOW), []);
    rmSync(linked, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
