/**
 * The herald (the castle's Hand of the King): E at him, or K from the throne, sends out a new worker,
 * hired at the first free seat at the tables and running off there from beside him.
 */
import { officeFull, pressureNote } from '../../../shared/machine';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import type { Parts } from '../../core/parts';
import { repoChoices } from '../../shared/hiring';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import { t } from '../../i18n';
import { openPrompt } from '../../ui/prompt';
import { hiringPaused } from '../../ui/usage';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    herald: true;
  }
}

/** Registers K (the herald, from the throne). */
export function installHerald(ctx: Ctx, parts: Pick<Parts, 'place' | 'you' | 'actions' | 'views'>) {
  const { plan } = ctx;

  // On the throne: the herald beside you, whoever's in line.
  ctx.keys.bind({
    code: 'KeyK',
    when: () => parts.place.onThrone() && !!ctx.world().herald,
    run: () => {
      parts.you.reach();
      hireFromHerald();
    },
  });
  /**
   * E at the herald (the castle's Hand of the King): what should a new worker do? It's hired at the
   * first free seat at the tables, and runs off there from beside him (see cameFrom).
   */
  function hireFromHerald() {
    const { actions, views } = parts;
    const h = plan().herald;
    if (!h || actions.officeIsFull()) return;
    if (!actions.firstFreeSeat()) return toast(t('toys.herald.full', { name: h.name }), 'warn');
    openPrompt({
      title: `${plan().icon} ${t('toys.herald.title', { name: h.name })}`,
      subtitle: t(plan().lineup.length ? (plan().throne ? 'toys.herald.subThrone' : 'toys.herald.subLineup') : 'toys.herald.sub'),
      warning: pressureNote(store.machine),
      placeholder: h.ask,
      submitLabel: h.button,
      allowEmpty: true,
      providerOption: true,
      worktreeOption: !!store.project?.branch,
      repoOptions: repoChoices(),
      onSubmit: (text, o) => {
        // Whichever seat is free now (someone may have sat down while you were thinking).
        const deskId = views.heraldSeat();
        if (!deskId) return toast(t('toys.herald.takenNow'), 'warn');
        views.heraldHires.set(deskId, { floor: store.floor, at: performance.now() });
        actions.hire(deskId, text || undefined, o.worktree, o.provider, o.model, o.effort, undefined, o.repos, 'herald');
      },
    });
  }

  ctx.interactions.define('herald', {
    reach: 5,
    hint: () => {
      const hd = plan().herald;
      const full = !parts.actions.firstFreeSeat();
      const m = store.machine;
      const why = full ? t('toys.herald.everySeat') : officeFull(m) ? t('toys.herald.officeFull', { n: m.workers, limit: m.limit ?? 0 }) : hiringPaused() ? t('toys.budgetSpent') : '';
      return { k: `${hd?.name}|${why}`, parts: [hintTitle(`${plan().icon} ${hd?.name ?? t('toys.herald.herald')}`), why ? h('span.cost', {}, why) : aside(hd?.says ?? ''), why ? '' : key('E', t('toys.herald.send'))] };
    },
    use: onE(() => hireFromHerald()),
  });
}
