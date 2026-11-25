import type { GhCheck, GhMergeMethod, GhPull, GhPullDetail } from '../../../shared/protocol';
import type { Net } from '../../net';
import { h, openModal } from '../dom';
import { labels, ltrText, t, tn } from '../../i18n';
import { ltr, rich } from '../../i18n/dom';
import { serverText } from '../../i18n/server';
import { mergeWaiters } from './api';
import { MERGE_KEY, mergePref, savePref } from './prefs';

// ---- Whether a PR can merge ---------------------------------------------------------------------

const CHECK_ICON: Record<GhCheck['state'], string> = { pass: '✅', fail: '❌', pending: '🟡', skip: '⚪' };
const CHECK_WORD = labels<GhCheck['state']>({ pass: 'github.check.pass', fail: 'github.check.fail', pending: 'github.check.pending', skip: 'github.check.skip' });

interface MergeStatus {
  icon: string;
  text: string;
  cls: 'ok' | 'warn' | 'bad' | 'muted';
  /** False when merging can't work at all (draft, conflicts, already merged). */
  can: boolean;
  /** GitHub could merge it on its own once the requirements pass. */
  auto: boolean;
}

/** An open PR whose branch can't merge until someone resolves conflicts with the base. */
export function conflicted(d: GhPullDetail) {
  return d.state === 'OPEN' && !d.isDraft && (d.mergeable === 'CONFLICTING' || d.mergeStateStatus === 'DIRTY');
}

export function mergeStatus(d: GhPullDetail): MergeStatus {
  const failing = d.checks.filter((c) => c.state === 'fail').length;
  const pending = d.checks.filter((c) => c.state === 'pending').length;
  const base = ltrText(d.baseRefName);
  if (d.state === 'MERGED') return { icon: '🎉', text: t('github.merge.merged'), cls: 'ok', can: false, auto: false };
  if (d.state === 'CLOSED') return { icon: '🗑️', text: t('github.merge.closed'), cls: 'muted', can: false, auto: false };
  if (d.isDraft) return { icon: '📝', text: t('github.merge.draft'), cls: 'muted', can: false, auto: false };
  if (conflicted(d))
    return { icon: '⚠️', text: t('github.merge.conflicts', { base }), cls: 'bad', can: false, auto: false };
  if (d.mergeStateStatus === 'BEHIND') return { icon: '⤵️', text: t('github.merge.behind', { base }), cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'BLOCKED') {
    const why = d.reviewDecision === 'CHANGES_REQUESTED' ? t('github.merge.why.changes') : d.reviewDecision === 'REVIEW_REQUIRED' ? t('github.merge.why.review') : failing ? tn('github.merge.why.failing', failing) : pending ? t('github.merge.why.pending') : t('github.merge.why.rule');
    return { icon: '🚫', text: t('github.merge.blocked', { why }), cls: 'bad', can: true, auto: true };
  }
  if (failing) return { icon: '❌', text: tn('github.merge.failing', failing), cls: 'warn', can: true, auto: false };
  if (pending || d.mergeStateStatus === 'UNSTABLE') return { icon: '🟡', text: t('github.merge.pending'), cls: 'warn', can: true, auto: true };
  if (d.mergeStateStatus === 'UNKNOWN' || d.mergeable === 'UNKNOWN') return { icon: '⏳', text: t('github.merge.unknown'), cls: 'muted', can: true, auto: false };
  return { icon: '✅', text: t(d.checks.length ? 'github.merge.readyChecks' : 'github.merge.ready', { base }), cls: 'ok', can: true, auto: false };
}

export function checksList(checks: GhCheck[]) {
  const order: GhCheck['state'][] = ['fail', 'pending', 'pass', 'skip'];
  const sorted = [...checks].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return h(
    'ul.gh-checks',
    {},
    ...sorted.map((c) => h('li', {}, h('span', { 'aria-label': CHECK_WORD[c.state] }, CHECK_ICON[c.state]), c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.name) : h('span', {}, c.name))),
  );
}

// ---- Merge dialog -------------------------------------------------------------------------------

const METHOD_LABEL: Record<GhMergeMethod, string> = labels({ squash: 'github.merge.squash', merge: 'github.merge.merge', rebase: 'github.merge.rebase' });

export function openMerge(it: GhPull, d: GhPullDetail, net: Net, handToWorker: () => void, onMerged: () => void) {
  const st = mergeStatus(d);
  const methods = d.repo.methods;
  let { method, deleteBranch } = mergePref(methods);
  let busy = false;

  const methodBtns = h('div.seg');
  const go = h('button.btn.primary', { type: 'button' });
  const auto = h('input', { type: 'checkbox', id: 'merge-auto' }) as HTMLInputElement;
  auto.checked = st.auto && st.cls !== 'ok';
  const renderMethods = () => {
    methodBtns.replaceChildren(
      ...methods.map((m) =>
        h('button.btn', { type: 'button', class: m === method ? 'on' : '', onclick: () => ((method = m), savePref(MERGE_KEY, { method, deleteBranch }), renderMethods()) }, METHOD_LABEL[m]),
      ),
    );
    go.textContent = auto.checked ? t('github.merge.whenReady') : `🔀 ${METHOD_LABEL[method]}`;
  };
  auto.addEventListener('change', renderMethods);
  const del = h('input', { type: 'checkbox', id: 'merge-del' }) as HTMLInputElement;
  del.checked = deleteBranch;
  del.addEventListener('change', () => {
    deleteBranch = del.checked;
    savePref(MERGE_KEY, { method, deleteBranch });
  });
  const result = h('div.gh-merge-result.hidden');
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  // Conflicts can't be merged from here, so fixing them is the main button.
  const worker = conflicted(d)
    ? h('button.btn.primary', { type: 'button', title: t('github.merge.fixTitle') }, t('github.newWorkerFix'))
    : h('button.btn', { type: 'button', title: t('github.merge.handTitle') }, t('github.handToWorker'));
  const num = String(it.number);

  const el = h(
    'div.modal.gh-merge',
    { role: 'dialog', 'aria-label': t('github.merge.aria', { num }) },
    h('header', {}, h('h2', {}, t('github.merge.title', { num }))),
    h(
      'div.body',
      {},
      h('p.gh-merge-title', {}, it.title, h('small.ltr', {}, `${it.headRefName} → ${it.baseRefName}`)),
      h('div.gh-status', { class: st.cls }, h('span', {}, st.icon), st.text),
      d.checks.length ? checksList(d.checks) : null,
      h('label', { style: 'margin-top:14px' }, t('github.merge.how')),
      methodBtns,
      h('label.gh-check', { for: 'merge-del' }, del, ...rich('github.merge.deleteBranch', { branch: ltr(it.headRefName) })),
      st.auto ? h('label.gh-check', { for: 'merge-auto', title: t('github.merge.autoTitle', { cmd: ltrText('gh pr merge --auto') }) }, auto, t('github.merge.auto')) : null,
      result,
    ),
    h('footer', {}, st.can || conflicted(d) ? null : worker, h('span.grow'), cancel, conflicted(d) ? worker : go),
  );
  renderMethods();
  if (!st.can) go.disabled = true;

  const modal = openModal(el, { onClose: () => mergeWaiters.delete(it.number) });
  cancel.addEventListener('click', () => modal.close());
  worker.addEventListener('click', () => {
    modal.close();
    handToWorker();
  });
  go.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    go.disabled = true;
    result.className = 'gh-merge-result';
    result.replaceChildren(h('span.spinner'), t(auto.checked && st.auto ? 'github.merge.asking' : 'github.merge.merging'));
    mergeWaiters.set(it.number, (msg) => {
      mergeWaiters.delete(it.number);
      busy = false;
      if (msg.error) {
        go.disabled = false;
        result.className = 'gh-merge-result error';
        result.replaceChildren(serverText(msg.error));
        return;
      }
      modal.close();
      onMerged();
    });
    net.send({ t: 'gh.merge', number: it.number, method, deleteBranch, auto: auto.checked && st.auto });
  });
  setTimeout(() => (st.can ? go : cancel).focus(), 30);
}
