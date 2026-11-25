import type { GhCloseReason, GhIssue, GhPull } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store, workerForPull } from '../../state';
import { h, openModal } from '../dom';
import { labels, t } from '../../i18n';
import { ltr, rich } from '../../i18n/dom';
import { serverText } from '../../i18n/server';
import { closeWaiters } from './api';

// ---- Close dialog -------------------------------------------------------------------------------

const REASON_LABEL: Record<GhCloseReason, string> = labels({ completed: 'github.close.completed', 'not planned': 'github.close.notPlanned' });

/** Closes an issue (as completed or not planned) or a PR without merging, with an optional comment. */
export function openClose(kind: 'issue' | 'pull', it: GhIssue | GhPull, net: Net, onClosed: () => void) {
  const key = `${kind}:${it.number}`;
  const pull = kind === 'pull' ? (it as GhPull) : null;
  const num = String(it.number);
  let reason: GhCloseReason = 'completed';
  let busy = false;

  const go = h('button.btn.danger', { type: 'button' });
  const reasons = h('div.seg');
  const renderReasons = () => {
    reasons.replaceChildren(...(Object.keys(REASON_LABEL) as GhCloseReason[]).map((r) => h('button.btn', { type: 'button', class: r === reason ? 'on' : '', onclick: () => ((reason = r), renderReasons()) }, REASON_LABEL[r])));
    go.textContent = t(pull ? 'github.close.goPull' : reason === 'completed' ? 'github.close.goCompleted' : 'github.close.goNotPlanned');
  };
  const comment = h('textarea', { rows: 4, placeholder: t('github.close.placeholder'), 'aria-label': t('github.close.commentAria') }) as HTMLTextAreaElement;
  const del = h('input', { type: 'checkbox', id: 'close-del' }) as HTMLInputElement;
  const w = pull && workerForPull(store.workers.values(), pull);
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': t(pull ? 'github.close.ariaPull' : 'github.close.ariaIssue', { num }) },
    h('header', {}, h('h2', {}, t(pull ? 'github.close.titlePull' : 'github.close.titleIssue', { num }))),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, pull ? h('small.ltr', {}, `${pull.headRefName} → ${pull.baseRefName}`) : null),
      pull
        ? h('div.gh-status.muted', {}, h('span', {}, 'ℹ️'), t('github.close.pullNote') + (w ? ` ${t('github.close.pullNoteWorker', { name: w.name })}` : ''))
        : h('label', {}, t('github.close.why')),
      pull ? h('label.gh-check', { for: 'close-del' }, del, ...rich('github.close.deleteBranch', { branch: ltr(pull.headRefName) })) : reasons,
      comment,
      result,
    ),
    h('footer', {}, h('span.grow'), cancel, go),
  );
  renderReasons();

  const modal = openModal(el, { onClose: () => closeWaiters.delete(key) });
  cancel.addEventListener('click', () => modal.close());
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), t(pull ? 'github.close.closingPull' : 'github.close.closingIssue'));
    closeWaiters.set(key, (msg) => {
      closeWaiters.delete(key);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(serverText(msg.error));
        return;
      }
      modal.close();
      onClosed();
    });
    net.send({ t: 'gh.close', kind, number: it.number, comment: comment.value.trim() || undefined, reason: pull ? undefined : reason, deleteBranch: !!pull && del.checked });
  });
  setTimeout(() => comment.focus(), 30);
}
