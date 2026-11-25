/**
 * The words of the bar games in the page's language: a throw's score as it's chalked up (Bull, Miss,
 * Killshot; T20 and the numbers stay as they are), and the chalkboards' own writing.
 */
import type { BarGame } from '../../../shared/bargames';
import { t } from '../../i18n';
import { dirFor, FONT } from '../../i18n/canvas';

const WORDS = { Bull: 'toys.throw.bull', Out: 'toys.throw.out', Miss: 'toys.throw.miss', Drop: 'toys.throw.drop', Killshot: 'toys.throw.killshot', Board: 'toys.throw.board', Wall: 'toys.throw.wall' } as const;

/** A score's label (shared/bargames.ts says it in English) as the page says it. */
export function scoreWord(label: string): string {
  const k = WORDS[label as keyof typeof WORDS];
  return k ? t(k) : label;
}

/** What a game's chalkboard says at its top. */
export function boardTitle(game: BarGame): string {
  return t(game === 'darts' ? 'toys.throw.chalk.darts' : 'toys.throw.chalk.axe');
}

/** What an empty chalkboard says (on two lines), and the word by a round's sum. */
export function chalkWords() {
  return { stepUp1: t('toys.throw.stepUp1'), stepUp2: t('toys.throw.stepUp2'), total: t('toys.throw.total') };
}

/** The chalkboards' hand, with Cairo behind it for Arabic. */
export function chalkFont(px: number): string {
  return `800 ${px}px "Chalkboard SE", "Comic Sans MS", ${FONT}`;
}

/** Chalks `text` up, in the direction it reads. */
export function chalkUp(g: CanvasRenderingContext2D, text: string, x: number, y: number) {
  dirFor(g, text);
  g.fillText(text, x, y);
  g.direction = 'ltr';
}
