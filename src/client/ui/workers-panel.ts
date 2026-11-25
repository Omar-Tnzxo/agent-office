// The workers list in the sidebar: every worker on your floor, what it's on, and what it has spent.
// One that needs you goes to the top, in red, saying what it's asking and for how long.

import { needyFirst } from '../nextup';
import { store } from '../state';
import { DESK_BY_ID } from '../../shared/layout';
import { $, h, STATUS_LABEL, timeAgo } from './dom';
import { usageLabel, usageTitle } from './usage';
import { providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';
import { ltrText, onLang, t } from '../i18n';

/** What it was last drawn with, so a switch of language can draw it again. */
let lastOpen: ((id: string) => void) | null = null;
onLang(() => lastOpen && renderWorkers(lastOpen));

export function renderWorkers(onOpen: (id: string) => void) {
  lastOpen = onOpen;
  const ul = $('workers');
  ul.replaceChildren();
  const workers = needyFirst(store.workers.values());
  for (const w of workers) {
    const asking = w.status === 'needs_input' && !w.lost;
    const provider = w.kind === 'agent' ? providerLabel(w.provider, store.project) : null;
    const providerKind = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const usageState = w.kind === 'agent' ? providerUsageState(w.provider, store.project, w.usage) : undefined;
    const waiting = usageState === 'waiting' ? providerWaitingLabel(providerKind, store.project) : '';
    const usageNote = usageState === 'untracked' ? ` · ${t('panels.wk.untracked')}` : waiting ? ` · ${waiting}` : '';
    const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort, w.usage?.model) : undefined;
    const sub = [provider && `⚙️ ${provider}${badge ? ` · ${badge}` : ''}${usageNote}`, w.worktree && `🌿 ${ltrText(w.worktree.branch)}`, w.repos?.length && `🗂️ ${t('panels.wk.repos', { n: w.repos.length + 1 })}`, w.pr && `🔀 PR #${w.pr.number}`, w.activity || w.title || w.prompt].filter(Boolean).join(' · ');
    // What it's stopped on, and since when, on a line of its own under its name.
    const ask = asking ? h('span.ask', {}, `🙋 ${w.activity ?? t('panels.wk.waiting')}${w.waitingSince ? ` · ${timeAgo(w.waitingSince)}` : ''}`) : null;
    ul.append(
      h(
        'li',
        { class: asking ? 'needs-you-row' : '', onclick: () => onOpen(w.id), title: t(asking ? 'panels.wk.needsYou.title' : 'panels.wk.open', { name: w.name }) },
        h('span.dot', { style: `background:${w.color}` }),
        h('span.name', {}, w.name, sub ? h('span.sub', {}, sub) : null,
          usageState === 'tracked' && w.usage ? h('span.cost', { title: usageTitle(w.usage, providerKind) }, usageLabel(w.usage, providerKind)) : null),
        w.lost ? h('span.pill.lost', { title: t('panels.wk.lost.title') }, t('panels.wk.lost')) : h('span.pill', { class: w.status }, asking ? t('panels.wk.needsYou') : (STATUS_LABEL[w.status] ?? w.status)),
        ask,
      ),
    );
  }
  if (!workers.length) ul.append(h('li.empty', {}, t('panels.wk.empty')));
  // The count is the workers hired onto desks and bean bags (and a meeting's table): the board agents
  // standing at the Issues, PR and queue kiosks are listed but aren't counted.
  const hired = workers.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length;
  $('worker-count').textContent = hired ? String(hired) : '';
  $('workers-panel').classList.toggle('needs-you-panel', workers.some((w) => w.status === 'needs_input'));
}
