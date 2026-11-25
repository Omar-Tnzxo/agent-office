/**
 * A visitor's laptop: there's no terminal behind it, so the office paints one from what it read of
 * its transcript (Visitor.screen): a title bar, its latest steps with the newest at the bottom, and
 * where it works along the foot. It's handed to the laptop as a terminal screen, so it's painted the
 * way a worker's is (see paintScreen in features/workers/laptop.ts), in big enough letters to read
 * from beside the desk.
 */
import type { Run, ScreenLine, Visitor } from '../../../shared/protocol';
import { isRtl, lang, t, type TextKey } from '../../i18n';
import { hasRtl } from '../../i18n/canvas';
import { toolText } from '../../i18n/server';
import type { ScreenState } from '../../state/store';

/** Across and down: few enough that the letters stay big on a laptop's screen. */
export const COLS = 40;
export const ROWS = 12;
/** What it wrote wraps onto at most this many rows; anything else is one row, cut short. */
const SAY_ROWS = 3;

/** Colors by kind, as indexes into the terminal's palette (see TERM_THEME), and which are bold. */
const COLOR: Record<ScreenLine['k'], number> = { say: 15, do: 14, add: 10, del: 9, out: 7, ask: 11, you: 13, err: 9 };
const BOLD = new Set<ScreenLine['k']>(['do', 'ask']);
const STATUS: Record<Visitor['status'], { label: TextKey; bg: number }> = {
  working: { label: 'watch.screen.working', bg: 2 },
  needs_input: { label: 'watch.screen.waiting', bg: 3 },
  done: { label: 'watch.screen.done', bg: 8 },
};
/** The lines the office wrote about a tool call ("Editing landing.md"), read in the page's language; the others are the session's own. */
const OFFICE_WORDS = new Set<ScreenLine['k']>(['do', 'ask', 'err']);

/**
 * A row as the laptop paints it: on an Arabic page, one with Arabic in it takes the whole width, so
 * it's drawn from the right edge (see paintWords in features/workers/laptop.ts), the way it reads.
 */
const rowText = (text: string) => (isRtl() && hasRtl(text) ? text.padEnd(COLS) : text);

/** `text` cut to `n` characters (by code point), with an ellipsis when it was longer. */
export function fit(text: string, n: number): string {
  const chars = [...text];
  return chars.length > n ? `${chars.slice(0, n - 1).join('')}…` : text;
}

/** `text` wrapped on spaces into rows of at most `n` characters, at most `max` of them (the last one cut short). */
export function wrap(text: string, n: number, max: number): string[] {
  if (max <= 1) return [fit(text, n)];
  const rows: string[] = [];
  const words = text.split(' ');
  let row = '';
  for (let i = 0; i < words.length; i++) {
    const next = row ? `${row} ${words[i]}` : words[i];
    if (!row || [...next].length <= n) {
      row = next;
      continue;
    }
    rows.push(row);
    // The last row there's room for takes the rest, cut short.
    if (rows.length === max - 1) {
      row = words.slice(i).join(' ');
      break;
    }
    row = words[i];
  }
  rows.push(row);
  return rows.map((r) => fit(r, n));
}

/**
 * The rows a laptop shows for these lines, oldest first, at most `room` of them: the newest lines,
 * whole (the oldest one shown wraps onto fewer rows, cut short, rather than losing its start).
 */
export function screenRows(lines: readonly ScreenLine[], room: number): Run[][] {
  const rows: Run[][] = [];
  for (let i = lines.length - 1; i >= 0 && rows.length < room; i--) {
    const l = lines[i];
    const fg = COLOR[l.k] ?? 7;
    const flags = BOLD.has(l.k) ? 1 : 0;
    const text = OFFICE_WORDS.has(l.k) ? toolText(l.t) : l.t;
    const texts = l.k === 'say' ? wrap(text, COLS - 1, Math.min(SAY_ROWS, room - rows.length)) : [fit(text, COLS - 1)];
    rows.unshift(...texts.map((s): Run[] => [[rowText(` ${s}`), fg, -1, flags]]));
  }
  return rows;
}

/** The whole screen for a visitor: its title bar, its steps (the newest at the bottom) and its folder along the foot. */
export function visitorScreen(v: Visitor, version: number): ScreenState {
  const status = STATUS[v.status];
  const label = t(status.label);
  const width = [...label].length;
  const head = fit(` ${v.title}`, COLS - width - 2);
  const gap = ' '.repeat(Math.max(1, COLS - [...head].length - width - 1));
  // Right to left, the bar is mirrored: the state on the left, the name on the right, each in cells of its own.
  const bar: Run[] = isRtl() ? [[` ${label}`, 0, status.bg, 1], [gap, 0, status.bg, 1], [`${head.slice(1)} `, 0, status.bg, 1]] : [[`${head}${gap}${label} `, 0, status.bg, 1]];
  const lines = v.screen?.length ? v.screen : [{ k: 'do' as const, t: v.status === 'needs_input' ? t('watch.screen.waitingLine') : (v.activity ?? t('watch.screen.workingLine')) }];
  const body = screenRows(lines, ROWS - 2);
  const foot: Run[] = [[fit(` ${v.folder}${v.branch ? ` (${v.branch})` : ''}`, COLS).padEnd(COLS), 7, 0, 4]];
  // Blank rows between the bar and the steps: a short list sits at the bottom, by the foot.
  const blank: Run[][] = Array.from({ length: ROWS - 2 - body.length }, () => []);
  return { cols: COLS, rows: ROWS, lines: [bar, ...blank, ...body, foot], cursor: [0, 0], version };
}

/** What each laptop shows now, and the key it was made from: a new screen (and a repaint) only when that changes. */
const shown = new WeakMap<object, { key: string; screen: ScreenState }>();
let versions = 0;

/** Puts what the office last read of `v` on `laptop`'s screen. */
export function showOnLaptop(laptop: object, v: Visitor) {
  // The language too: a switch paints its words again (visitors/index.ts shows each visitor again on one).
  const key = JSON.stringify([lang(), v.title, v.status, v.activity, v.folder, v.branch, v.screen]);
  if (shown.get(laptop)?.key === key) return;
  shown.set(laptop, { key, screen: visitorScreen(v, ++versions) });
}

/** What `laptop` shows, for its update (undefined: it hasn't been shown anything, and says so). */
export const laptopScreen = (laptop: object): ScreenState | undefined => shown.get(laptop)?.screen;
