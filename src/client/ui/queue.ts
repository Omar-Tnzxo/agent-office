import './queue.css';
import type { AgentProvider, QueueTask, Usage } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, STATUS_LABEL } from './dom';
import { confirmDialog } from './prompt';
import { providerPicker, providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';
import { officeFull } from '../../shared/machine';
import { dictateField } from './dictate';
import { ltrText, t, tn } from '../i18n';
import { rich } from '../i18n/dom';
import { serverText } from '../i18n/server';

export interface QueueActions {
  openTerminal(workerId: string): void;
}

/** The queue task's name, linked to its GitHub issue when it has one. */
function taskTitle(task: QueueTask): HTMLElement {
  if (task.issue === undefined) return h('div.queue-title', { title: task.prompt }, task.title);
  const issue = store.issues.items.find((i) => i.number === task.issue);
  const text = task.title.startsWith(`#${task.issue}`) ? task.title : `#${task.issue} ${task.title}`;
  return h('div.queue-title', { title: task.prompt }, issue ? h('a', { href: issue.url, target: '_blank', rel: 'noopener' }, text) : text);
}

function outcome(task: QueueTask): string {
  switch (task.outcome) {
    case 'done':
      return t(task.pr ? 'work.queue.finished' : 'work.queue.finishedNoPr');
    case 'exited':
      return task.error ? t('work.queue.stoppedWhy', { error: serverText(task.error) }) : t('work.queue.stopped');
    case 'killed':
      return t('work.queue.sentHome');
    case 'failed':
      return t('work.queue.failed', { error: task.error ? serverText(task.error) : t('work.queue.unknownError') });
    default:
      return '';
  }
}

export function openQueue(net: Net, actions: QueueActions) {
  const body = h('div.body.queue');
  const close = h('button.btn.close', { 'aria-label': t('common.close') }, '✕');
  const limitValue = h('b');
  const minus = h('button.btn', { type: 'button', title: t('work.queue.fewer'), 'aria-label': t('work.queue.fewer') }, '−');
  const plus = h('button.btn', { type: 'button', title: t('work.queue.more'), 'aria-label': t('work.queue.more') }, '+');
  const limit = h('div.queue-limit', { title: t('work.queue.limitTitle') }, t('work.queue.atOnce'), minus, limitValue, plus);
  minus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers - 1 }));
  plus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers + 1 }));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('work.queue.aria'), style: 'width:min(800px,100%)' },
    h('header', {}, h('h2', {}, t('work.queue.title')), limit, close),
    body,
    h('footer', {}, h('span.grow', {}, t('work.queue.foot'))),
  );

  const ta = h('textarea', { rows: 2, placeholder: t('work.queue.placeholder'), 'aria-label': t('work.queue.newTask') }) as HTMLTextAreaElement;
  const provider = providerPicker(store.project, 'queue-provider');
  const addBtn = h('button.btn.primary', { type: 'submit' }, t('work.queue.add'));
  const form = h('form.queue-add', {}, dictateField(ta), provider.element, addBtn) as HTMLFormElement;
  form.noValidate = true;
  const submit = () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    if (!provider.valid()) return;
    net.send({ t: 'queue.add', prompt: text, provider: provider.value(), model: provider.model(), effort: provider.effort() });
    ta.value = '';
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  const section = (title: string, tasks: QueueTask[], extra?: HTMLElement) => {
    if (!tasks.length) return null;
    return h('div', {}, h('h4', {}, title, h('span.count', {}, String(tasks.length)), extra ?? null), h('ul.queue-list', {}, ...tasks.map(row)));
  };

  const row = (task: QueueTask): HTMLElement => {
    const w = task.workerId ? store.workers.get(task.workerId) : undefined;
    const meta: string[] = [];
    const buttons: HTMLElement[] = [];
    const badge = modelBadge(task.provider, task.model, task.effort);
    const model = badge ? ` · ${t('work.queue.initial', { badge })}` : '';
    const usageSuffix = (provider: AgentProvider | undefined, usage?: Usage) => {
      const state = providerUsageState(provider, store.project, usage);
      if (state === 'untracked') return ` · ${t('work.usageUntracked')}`;
      if (state !== 'waiting') return '';
      const waiting = providerWaitingLabel(provider, store.project);
      return waiting ? ` · ${waiting}` : '';
    };
    let pos: string | null = null;
    if (task.status === 'running') {
      const selectedProvider = providerLabel(task.provider ?? w?.provider, store.project);
      meta.push(`⚙️ ${selectedProvider}${model}${usageSuffix(task.provider ?? w?.provider, w?.usage)}`);
      meta.push(`${task.workerName ?? t('work.aWorkerLower')} · ${w ? STATUS_LABEL[w.status] ?? w.status : t('work.queue.gone')}`);
      if (task.branch) meta.push(`🌿 ${ltrText(task.branch)}`);
      if (task.startedAt) meta.push(t('work.startedWhen', { when: timeAgo(task.startedAt) }));
      meta.push(t('work.queue.by', { name: task.addedBy }));
      if (w) {
        buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, t('work.terminal')));
        buttons.push(
          h('button.btn', {
            type: 'button',
            title: t('work.queue.stopTitle'),
            onclick: () => confirmDialog(t('work.queue.stopAsk', { name: w.name }), t('work.queue.stopBody', { name: w.name }), t('work.queue.stopLabel'), () => net.send({ t: 'worker.kill', workerId: w.id })),
          }, t('work.queue.stop')),
        );
      }
    } else if (task.status === 'queued') {
      const queued = store.queue.tasks.filter((x) => x.status === 'queued');
      const i = queued.indexOf(task);
      pos = String(i + 1);
      meta.push(`⚙️ ${providerLabel(task.provider, store.project)}${model}${usageSuffix(task.provider, w?.usage)}`);
      meta.push(t('work.queue.addedBy', { name: task.addedBy, when: timeAgo(task.addedAt) }));
      buttons.push(h('button.btn', { type: 'button', title: t('work.queue.up'), 'aria-label': t('work.queue.up'), disabled: i === 0, onclick: () => net.send({ t: 'queue.move', taskId: task.id, delta: -1 }) }, '↑'));
      buttons.push(h('button.btn', { type: 'button', title: t('work.queue.down'), 'aria-label': t('work.queue.down'), disabled: i === queued.length - 1, onclick: () => net.send({ t: 'queue.move', taskId: task.id, delta: 1 }) }, '↓'));
      buttons.push(h('button.btn', { type: 'button', title: t('work.queue.remove'), 'aria-label': t('common.remove'), onclick: () => net.send({ t: 'queue.remove', taskId: task.id }) }, '✕'));
    } else {
      meta.push(`⚙️ ${providerLabel(task.provider, store.project)}${model}${usageSuffix(task.provider, w?.usage)}`);
      meta.push(outcome(task));
      if (task.workerName) meta.push(task.workerName);
      if (task.branch) meta.push(`🌿 ${ltrText(task.branch)}`);
      if (task.finishedAt) meta.push(timeAgo(task.finishedAt));
      if (task.pr) buttons.push(h('a.btn', { href: task.pr.url, target: '_blank', rel: 'noopener', title: task.pr.title }, `🔀 PR #${task.pr.number}${task.pr.state === 'MERGED' ? ' ✓' : task.pr.state === 'DRAFT' ? ` ${t('work.queue.draft')}` : ''}`));
      if (w) buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, t('work.terminal')));
      buttons.push(h('button.btn', { type: 'button', title: t('work.queue.requeueTitle'), onclick: () => net.send({ t: 'queue.retry', taskId: task.id }) }, t('work.queue.requeue')));
      buttons.push(h('button.btn', { type: 'button', title: t('work.queue.forget'), 'aria-label': t('common.remove'), onclick: () => net.send({ t: 'queue.remove', taskId: task.id }) }, '✕'));
    }
    return h(
      'li',
      { class: task.status },
      pos ? h('span.pos', {}, pos) : null,
      h('div.queue-main', {}, taskTitle(task), h('div.queue-meta', {}, meta.join(' · '))),
      h('div.queue-actions', {}, ...buttons),
    );
  };

  // The form stays put and only the list below it re-renders, so worker updates don't pull focus out of the textarea.
  const list = h('div');
  body.append(form, list);

  const render = () => {
    const q = store.queue;
    limitValue.textContent = q.maxWorkers === 0 ? t('work.queue.paused') : String(q.maxWorkers);
    minus.toggleAttribute('disabled', q.maxWorkers <= 0);
    const running = q.tasks.filter((x) => x.status === 'running');
    const queued = q.tasks.filter((x) => x.status === 'queued');
    const done = q.tasks.filter((x) => x.status === 'done').slice().reverse();
    const m = store.machine;
    const parts: (HTMLElement | null)[] = [
      h('p.note', {}, ...rich('work.queue.note', { add: h('b', {}, t('work.queue.add')), max: h('b', {}, String(q.maxWorkers)) })),
      queued.length && officeFull(m) ? h('p.note', {}, tn('work.queue.full', m.limit ?? 0)) : null,
      section(t('work.queue.running'), running),
      section(t('work.queue.upNext'), queued),
      section(t('work.queue.done'), done, h('button.btn', { type: 'button', onclick: () => net.send({ t: 'queue.clear' }) }, t('work.clear'))),
      running.length + queued.length + done.length ? null : h('div.queue-empty', {}, t('work.queue.empty')),
    ];
    list.replaceChildren(...parts.filter((n): n is HTMLElement => n !== null));
  };

  // The machine reports every few seconds; only a change to whether the office is full shows here.
  let full = '';
  const machineChanged = () => {
    const k = `${officeFull(store.machine)}|${store.machine.limit}`;
    if (k === full) return;
    full = k;
    render();
  };
  const unsubs = [store.on('queue', render), store.on('workers', render), store.on('issues', render), store.on('machine', machineChanged)];
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: '📥 at the queue',
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => ta.focus(), 30);
}
