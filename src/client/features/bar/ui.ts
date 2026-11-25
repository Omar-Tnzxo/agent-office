import { DRINKS, type Drink } from '../../../shared/rooftop';
import { h, openModal } from '../../ui/dom';
import { t } from '../../i18n';

export interface BarOptions {
  /** Had enough: nothing stronger than water or a mocktail. */
  cutOff: boolean;
  order(d: Drink): void;
}

/** How hard a drink hits, for the menu. */
function kick(d: Drink): string {
  if (d.strength < 0) return t('toys.bar.kick.sobers');
  if (d.strength === 0) return t('toys.bar.kick.none');
  return t(d.strength >= 0.55 ? 'toys.bar.kick.strong' : d.strength >= 0.4 ? 'toys.bar.kick.head' : 'toys.bar.kick.light');
}

/** The rooftop bar's menu: pick a drink and the bartender pours it. */
export function openBar(opts: BarOptions) {
  const close = h('button.btn.close', { 'aria-label': t('common.close') }, '✕');
  const list = h(
    'ul.svc-list',
    {},
    ...DRINKS.map((d) => {
      const refused = opts.cutOff && d.strength > 0;
      const name = t(`toys.drink.${d.id}` as const);
      const li = h(
        'li',
        {
          tabindex: refused ? -1 : 0,
          role: 'button',
          'aria-disabled': String(refused),
          title: refused ? t('toys.bar.refused') : t('toys.bar.orderOne', { drink: name.toLowerCase() }),
          style: refused ? 'opacity:.45;cursor:not-allowed' : '',
        },
        h('span.jb-icon', { style: 'font-size:26px' }, d.emoji),
        h('div.svc-main', {}, h('div.svc-title', {}, name), h('div.svc-meta', {}, `${t(`toys.drinkBlurb.${d.id}` as const)} · ${kick(d)}`)),
      );
      const pick = () => {
        if (refused) return;
        modal.close();
        opts.order(d);
      };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      });
      return li;
    }),
  );
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': t('toys.bar.label') },
    h('header', {}, h('h2', {}, t('toys.bar.title')), close),
    h(
      'div.body',
      {},
      opts.cutOff ? h('p.setting-note', { style: 'margin:0 0 12px;font-weight:800' }, t('toys.bar.cutNote')) : null,
      list,
    ),
    h('footer', {}, h('span.grow', {}, t('toys.bar.foot'))),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  setTimeout(() => (list.querySelector('li[tabindex="0"]') as HTMLElement | null)?.focus(), 30);
}
