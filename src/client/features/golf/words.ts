/** The golf course's words in the page's language: how far a ball is from the pin, and where it stopped. */
import { t } from '../../i18n';
import type { Flight } from './world';

/** A distance to the pin, as it's read out: "40 cm", "3.4 m", "27 m". */
export function pinText(m: number): string {
  if (m < 1) return t('toys.golf.cm', { n: String(Math.round(m * 100)) });
  return t('toys.golf.m', { n: m < 10 ? m.toFixed(1) : String(Math.round(m)) });
}

/** Where a ball stopped, in words. */
export function lieText(f: Flight): string {
  if (f.holed) return t('toys.golf.inHole');
  switch (f.lie) {
    case 'lost':
      return t('toys.golf.lost');
    case 'deck':
      return t('toys.golf.deck');
    case 'below':
      return t('toys.golf.below');
    case 'roof':
      return t('toys.golf.roof');
    case 'sand':
      return t('toys.golf.bunker', { d: pinText(f.fromPin) });
    case 'green':
      return t('toys.golf.green', { d: pinText(f.fromPin) });
    default:
      return t('toys.golf.fromPin', { d: pinText(f.fromPin) });
  }
}
