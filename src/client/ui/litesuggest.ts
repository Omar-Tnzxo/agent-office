import './litesuggest.css';
// Offering the 2D view (/lite) where the 3D office is hard going: on a phone, with no keys to walk
// with, or on a computer where frames come slowly (see framerate.ts).

import { h } from './dom';
import { t } from '../i18n';

/** Said to stay in 3D: this browser isn't offered the 2D view again (it's in the ☰ menu). */
const DECLINED_KEY = 'agent-office.lite-declined';

/** A touch screen and no mouse: a phone or a tablet, which can't walk around the office anyway. */
export function touchOnly(): boolean {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

function declined(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) === '1';
  } catch {
    return false;
  }
}

let offered = false;

/** Offers the 2D view, at most once a page, unless this browser said to stay in 3D before. */
export function offerLite(why: 'touch' | 'slow') {
  if (offered || declined()) return;
  offered = true;
  const say = t(why === 'touch' ? 'panels.lite.touch' : 'panels.lite.slow');
  const stay = h('button.btn', { type: 'button' }, t('panels.lite.stay'));
  const el = h(
    'div.lite-offer.panel',
    { role: 'dialog', 'aria-label': t('panels.lite.label') },
    h('p', {}, say),
    h('div.lite-offer-btns', {}, h('a.btn.primary', { href: '/lite' }, t('panels.lite.open')), stay),
  );
  stay.addEventListener('click', () => {
    try {
      localStorage.setItem(DECLINED_KEY, '1');
    } catch {
      // storage blocked: it's only this page then
    }
    el.remove();
  });
  document.body.append(el);
}
