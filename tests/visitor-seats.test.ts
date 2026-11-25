import test from 'node:test';
import assert from 'node:assert/strict';
import { DESKS, WING_DESKS, nextFreeSeat } from '../src/shared/layout.js';
import type { Visitor } from '../src/shared/protocol.js';
import { assignDesks, assignSpots, visitorDesks, wantsDesk } from '../src/client/features/visitors/seats.js';

// Which desk a visitor sits at, and its lobby spot (features/visitors/seats.ts): workers first, the
// same answer for the same floor, and nobody moved who doesn't have to be.

type Sitter = Pick<Visitor, 'id' | 'status' | 'lobby'>;
const at = (id: string, status: Visitor['status'] = 'working', lobby = false): Sitter => ({ id, status, lobby });
const none = new Map<string, string>();
const seats = (m: Map<string, string>) => Object.fromEntries(m);

test('a visitor at work on the floor own repository wants a desk; one that is done, or of another repository, does not', () => {
  assert.equal(wantsDesk(at('a', 'working')), true);
  assert.equal(wantsDesk(at('a', 'needs_input')), true);
  assert.equal(wantsDesk(at('a', 'done')), false);
  assert.equal(wantsDesk(at('a', 'working', true)), false);
});

test('visitors take the desks the office hires at last: its own order backwards, the back office only once it is built', () => {
  const room = visitorDesks(0);
  assert.equal(room.length, DESKS.length);
  assert.equal(room[0], 'desk-16');
  assert.equal(room[room.length - 1], 'desk-1');
  assert.deepEqual(visitorDesks(1).slice(0, 3), ['desk-18', 'desk-17', 'desk-16']);
  assert.equal(visitorDesks(2).length, DESKS.length + WING_DESKS.length);
  // The seat the office gives the next worker is the last one a visitor would take.
  assert.equal(nextFreeSeat(() => false, 2)!.id, visitorDesks(2).at(-1));
  assert.ok(visitorDesks(2).every((id) => id.startsWith('desk-')), 'never a bean bag, a kiosk or a meeting chair');
});

test('each working visitor gets a desk, in the order they are listed, and the same list gives the same desks', () => {
  const list = [at('a'), at('b', 'needs_input'), at('c', 'done'), at('d', 'working', true), at('e')];
  const free = visitorDesks(0);
  const got = assignDesks(list, free, none);
  assert.deepEqual(seats(got), { a: 'desk-16', b: 'desk-15', e: 'desk-14' });
  assert.deepEqual(seats(assignDesks(list, free, none)), seats(got));
  // Asked again with what it said, nothing moves.
  assert.deepEqual(seats(assignDesks(list, free, got)), seats(got));
});

test('a visitor keeps its desk while it works, even when one it would have preferred comes free', () => {
  const free = visitorDesks(0);
  const first = assignDesks([at('a'), at('b')], free, none);
  assert.deepEqual(seats(first), { a: 'desk-16', b: 'desk-15' });
  // a leaves the list: b stays where it is.
  assert.deepEqual(seats(assignDesks([at('b')], free, first)), { b: 'desk-15' });
});

test('a worker hired at a visitor desk moves that visitor to the next free one, and nobody else', () => {
  const free = visitorDesks(0);
  const first = assignDesks([at('a'), at('b'), at('c')], free, none);
  const hired = free.filter((id) => id !== 'desk-15');
  assert.deepEqual(seats(assignDesks([at('a'), at('b'), at('c')], hired, first)), { a: 'desk-16', b: 'desk-13', c: 'desk-14' });
});

test('with no desk free a visitor has none, and gets one when a worker is sent home', () => {
  const list = [at('a'), at('b')];
  const one = assignDesks(list, ['desk-3'], none);
  assert.deepEqual(seats(one), { a: 'desk-3' });
  assert.deepEqual(seats(assignDesks(list, [], one)), {});
  assert.deepEqual(seats(assignDesks(list, ['desk-9', 'desk-3'], one)), { a: 'desk-3', b: 'desk-9' });
});

test('a visitor whose turn is over goes back to the same desk when it works again, if the desk is still free', () => {
  const free = visitorDesks(0);
  const working = assignDesks([at('a'), at('b')], free, none);
  // a is done: it has no seat, but the desk is remembered, and a newcomer sits somewhere else.
  const resting = assignDesks([at('a', 'done'), at('b'), at('c')], free, working);
  assert.deepEqual(seats(resting), { a: 'desk-16', b: 'desk-15', c: 'desk-14' });
  assert.equal(wantsDesk(at('a', 'done')), false);
  assert.deepEqual(seats(assignDesks([at('a'), at('b'), at('c')], free, resting)), { a: 'desk-16', b: 'desk-15', c: 'desk-14' });
  // A worker took it meanwhile: it's forgotten, and a takes the next free one.
  const taken = assignDesks([at('a', 'done'), at('b'), at('c')], free.filter((id) => id !== 'desk-16'), resting);
  assert.deepEqual(seats(taken), { b: 'desk-15', c: 'desk-14' });
  assert.equal(assignDesks([at('a'), at('b'), at('c')], free.filter((id) => id !== 'desk-16'), taken).get('a'), 'desk-13');
});

test('a desk someone is coming back to is the last a newcomer takes, and then it is the newcomer desk', () => {
  const free = ['desk-2', 'desk-1'];
  const first = assignDesks([at('a'), at('b')], free, none);
  const resting = assignDesks([at('a', 'done'), at('b')], free, first);
  assert.deepEqual(seats(resting), { a: 'desk-2', b: 'desk-1' });
  // c has nowhere else to sit: it takes a's desk, and a stands when it works again.
  const crowded = assignDesks([at('a', 'done'), at('b'), at('c')], free, resting);
  assert.deepEqual(seats(crowded), { b: 'desk-1', c: 'desk-2' });
  assert.deepEqual(seats(assignDesks([at('a'), at('b'), at('c')], free, crowded)), { b: 'desk-1', c: 'desk-2' });
});

test('a visitor that turns out to be of another repository gives its desk up for good', () => {
  const free = visitorDesks(0);
  const first = assignDesks([at('a'), at('b')], free, none);
  const moved = assignDesks([at('a', 'working', true), at('b')], free, first);
  assert.deepEqual(seats(moved), { b: 'desk-15' });
  // Nobody is coming back to desk 16: the next one to start takes it.
  assert.equal(assignDesks([at('a', 'working', true), at('b'), at('c')], free, moved).get('c'), 'desk-16');
});

test('no two visitors ever share a desk, and none sits at one that is not free', () => {
  const list = Array.from({ length: 8 }, (_, i) => at(`v${i}`, i % 3 === 2 ? 'done' : 'working'));
  const free = ['desk-9', 'desk-4', 'desk-2'];
  // What it's told it said last time may be stale, or wrong.
  const held = new Map([['v0', 'desk-4'], ['v1', 'desk-4'], ['v3', 'desk-77'], ['v4', 'desk-2']]);
  const got = assignDesks(list, free, held);
  assert.equal(new Set(got.values()).size, got.size);
  assert.ok([...got.values()].every((id) => free.includes(id)));
  assert.deepEqual(seats(got), { v0: 'desk-4', v4: 'desk-2', v1: 'desk-9' });
});

test('a lobby spot is kept for as long as the visitor is listed, and a newcomer takes the first free one', () => {
  const first = assignSpots(['a', 'b', 'c'], new Map(), 8);
  assert.deepEqual(Object.fromEntries(first), { a: 0, b: 1, c: 2 });
  // a leaves: nobody shuffles along, and d takes the spot a left.
  const next = assignSpots(['b', 'c', 'd'], first, 8);
  assert.deepEqual(Object.fromEntries(next), { b: 1, c: 2, d: 0 });
  // No more spots than there are.
  assert.equal(assignSpots(['a', 'b', 'c'], new Map(), 2).size, 2);
  assert.deepEqual(Object.fromEntries(assignSpots(['a', 'b'], new Map([['a', 5], ['b', 5]]), 4)), { a: 0, b: 1 });
});
