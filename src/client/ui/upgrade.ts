import './upgrade.css';
import type { UpgradeState, VersionInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { isAsleep } from '../../shared/status';
import { store } from '../state';
import { closeAllModals, h, openModal, timeAgo, type Modal } from './dom';
import { ltrText, t, tn } from '../i18n';
import { rich } from '../i18n/dom';
import { serverText } from '../i18n/server';

const version = (v: VersionInfo) => h('span.version', {}, h('code', {}, v.sha), ' ', v.subject, h('small', {}, ` · ${timeAgo(v.date)}`));

/** The ⬆️ panel: what's running, what's new upstream, and the button to upgrade. */
export function openUpgrade(net: Net) {
  const body = h('div.body.upgrade');
  const close = h('button.btn.close', { 'aria-label': t('common.close') }, '✕');
  const recheck = h('button.btn', { type: 'button', onclick: () => net.send({ t: 'upgrade.check' }) }, t('panels.up.recheck'));
  const go = h('button.btn.primary', { type: 'button', onclick: () => net.send({ t: 'upgrade.start' }) }, t('panels.up.go'));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('panels.up.label'), style: 'width:min(620px,100%)' },
    h('header', {}, h('h2', {}, t('panels.up.title')), close),
    body,
    h('footer', {}, h('span.grow', {}), recheck, go),
  );

  const render = () => {
    const u = store.upgrade;
    body.replaceChildren();
    if (u.current) body.append(h('label', {}, t('panels.up.running')), version(u.current));
    const busy = u.phase === 'building' || u.phase === 'restarting';
    recheck.disabled = !!u.checking || busy;
    go.disabled = !u.latest || !!u.checking || busy;

    if (u.phase === 'building') {
      const what = u.latest?.sha ? ltrText(u.latest.sha) : t('panels.up.newVersion');
      body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), t(u.by ? 'panels.up.buildingBy' : 'panels.up.building', { what, who: u.by ?? '' })));
    } else if (u.phase === 'failed' && u.error) {
      body.append(h('pre.upgrade-error', {}, u.error));
    }
    if (u.checking) body.append(h('p.upgrade-status.busy', {}, h('span.spinner'), t('panels.up.checking')));
    else if (u.error && u.phase !== 'failed') body.append(h('p.upgrade-status.error', {}, serverText(u.error)));
    else if (!u.latest && u.checkedAt) body.append(h('p.upgrade-status.ok', {}, t('panels.up.upToDate', { when: timeAgo(u.checkedAt) })));

    if (u.latest) {
      const n = u.behind ?? u.changes?.length ?? 0;
      const shown = u.changes?.length ?? 0;
      body.append(
        h('label', { style: 'margin-top:14px' }, n >= 50 ? t('panels.up.new50') : tn('panels.up.new', n)),
        h('ul.changes', {}, ...(u.changes ?? []).map((c) => h('li', {}, h('code', {}, c.sha), ' ', c.subject))),
      );
      if (n > shown) body.append(h('p.note', {}, n >= 50 ? t('panels.up.andMore') : t('panels.up.andN', { n: n - shown })));
      if (!busy) {
        const awake = [...store.workers.values()].some((w) => !isAsleep(w.status));
        body.append(
          h(
            'p.note',
            {},
            t('panels.up.how'),
            awake ? t('panels.up.awake') : '',
          ),
        );
      }
    }
  };

  const unsub = store.on('upgrade', render);
  const unsubWorkers = store.on('workers', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      unsubWorkers();
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'upgrade.check' });
}

// --- Restart: a modal saying so, then a reload onto the new version ------------------------------

let restartModal: Modal | null = null;
/** The office said it's restarting: this page reloads when it's back, whether or not the window is still up. */
let restartPending = false;

export const restarting = () => restartPending;
let restartBody: HTMLElement | null = null;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

function restartDialog(title: string, ...content: (Node | string)[]) {
  if (!restartModal) {
    closeAllModals();
    restartBody = h('div.body');
    const el = h('div.modal.restart', { role: 'alertdialog', 'aria-label': t('panels.up.upgrading') }, h('header', {}, h('h2', {})), restartBody);
    // Closing it only hides it: the reload still comes once the office is back.
    restartModal = openModal(el, {
      backdropCloses: false,
      onClose: () => {
        restartModal = null;
        restartBody = null;
      },
    });
  }
  restartModal.el.querySelector('h2')!.textContent = title;
  restartBody!.replaceChildren(...content);
}

/** The server said it's about to restart into a new version. */
export function showRestarting(u: UpgradeState, net: Net) {
  net.expectRestart();
  restartPending = true;
  restartDialog(
    t('panels.up.restart.title'),
    h('div.restart-art', {}, '🏗️'),
    h('p', {}, `${u.by ? t('panels.up.restart.by', { who: u.by }) : t('panels.up.restart')}${u.latest ? t('panels.up.restart.to', { sha: ltrText(u.latest.sha), subject: u.latest.subject }) : ''}.`),
    h('p.upgrade-status.busy', {}, h('span.spinner'), t('panels.up.restart.wait')),
  );
  clearTimeout(slowTimer);
  slowTimer = setTimeout(
    () =>
      restartBody?.append(
        h('p.note', {}, t('panels.up.slow'), h('button.btn', { type: 'button', onclick: () => location.reload() }, t('panels.up.reload'))),
      ),
    3 * 60_000,
  );
}

/** Reconnected to a different version than this page was loaded from: load the new client. */
export function showUpgraded(u: UpgradeState) {
  clearTimeout(slowTimer);
  const v = u.current;
  restartDialog(
    t('panels.up.done.title'),
    h('div.restart-art', {}, '🎉'),
    v ? h('p', {}, ...rich('panels.up.done.now', { sha: h('code', {}, v.sha) }, { subject: v.subject })) : h('p', {}, t('panels.up.done.new')),
    h('p.upgrade-status.ok', {}, h('span.spinner'), t('panels.up.done.loading')),
  );
  setTimeout(() => location.reload(), 2500);
}
