/**
 * Words drawn on canvases (name tags, cards, desk signs, boards). A canvas shapes Arabic when its
 * font has the letters and it's told the text's direction, so every label draws with FONT, which
 * starts with the bundled Cairo for Arabic (styles/arabic.css), sets `ctx.direction` with
 * `textDir`, and the page waits for `fontsReady()` before it builds the office, so the first labels
 * aren't drawn in a fallback font and never redrawn.
 */
import { lang, onLang, relang } from '.';

/** The office's font for canvas text: Cairo for Arabic letters, the office's own for the rest. */
export const FONT = "Cairo, Nunito, ui-rounded, 'SF Pro Rounded', system-ui, sans-serif";

/** A range of characters for a regular expression, from code points (kept out of the source as raw characters). */
const span = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
/** Arabic, and the other right-to-left scripts' letters (Hebrew and Syriac among them). */
const RTL_LETTERS = span(0x0590, 0x08ff) + span(0xfb1d, 0xfdff) + span(0xfe70, 0xfefe);
const RTL = new RegExp(`[${RTL_LETTERS}]`);
/** A letter that sets a direction: Latin, Greek, Cyrillic, or a right-to-left one. */
const STRONG = new RegExp(`[A-Za-z${span(0x00c0, 0x024f)}${span(0x0370, 0x04ff)}${RTL_LETTERS}]`);

export function hasRtl(text: string): boolean {
  return RTL.test(text);
}

/**
 * Which way a label reads. Text with no Arabic is left to right. With some, it's right to left on an
 * Arabic page; on an English one it follows its first letter, so "عمر" reads right to left and
 * "Claude · عمر" left to right.
 */
export function textDir(text: string): CanvasDirection {
  if (!hasRtl(text)) return 'ltr';
  if (lang() === 'ar') return 'rtl';
  const first = STRONG.exec(text)?.[0] ?? '';
  return RTL.test(first) ? 'rtl' : 'ltr';
}

/** Sets the canvas's direction for `text` before it's measured or drawn. */
export function dirFor(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.direction = textDir(text);
}

let ready: Promise<void> | null = null;
let loaded = false;

/**
 * Loads Cairo's weights the canvases draw with, at most `wait` milliseconds, so labels drawn after it
 * have their Arabic letters. Safe to call again; once it's loaded it resolves at once. The page only
 * waits for it in Arabic (main.ts): English labels don't need it.
 */
export function fontsReady(wait = 2500): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  ready ??= Promise.race([
    Promise.all(['700', '800'].map((w) => document.fonts.load(`${w} 32px Cairo`, 'عربي'))).then(() => void (loaded = true)),
    new Promise<void>((done) => setTimeout(done, wait)),
  ]).catch(() => undefined);
  return ready;
}

// A switch to Arabic before the font is in: the labels drawn now are drawn again once it is.
onLang((l) => {
  if (l !== 'ar' || loaded) return;
  void fontsReady().then(() => {
    if (loaded && lang() === 'ar') relang();
  });
});
