// ⚙️ Settings' Outside, under Building: what the sky's doing, and which clock it keeps, for everyone
// (see server/sky.ts).
import type { Net } from '../net';
import { store } from '../state';
import { h } from './dom';
import { describeSky } from '../world/sky';
import { t } from '../i18n';

/**
 * The setting, made by `frame` from what goes in it: the sky now (`outside`, see describeSky), the
 * real time of day or a whole day and night every hour as buttons, and a note. Kept up to date until `off`.
 */
export function outsideSetting(net: Net, outside: { now: string; live: boolean }, frame: (body: Node[]) => HTMLElement): { section: HTMLElement; off: () => void } {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': t('settings.sky.clock') });
  const now = h('p.outside-now');
  const note = h('p.setting-note');
  const paint = () => {
    const real = !!store.sky?.realTime;
    now.textContent = store.sky ? describeSky(store.sky) : outside.now;
    row.replaceChildren(
      ...[true, false].map((r) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(real === r),
            class: real === r ? 'on' : '',
            onclick: () => r !== !!store.sky?.realTime && net.send({ t: 'sky.clock', real: r }),
          },
          t(r ? 'settings.sky.real' : 'settings.sky.fast'),
        ),
      ),
    );
    note.textContent = t(real ? 'settings.sky.noteReal' : 'settings.sky.noteFast', { weather: t(outside.live ? 'settings.sky.live' : 'settings.sky.made') });
  };
  paint();
  return { section: frame([now, row, note]), off: store.on('sky', paint) };
}
