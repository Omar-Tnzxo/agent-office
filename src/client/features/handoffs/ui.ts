import './ui.css';
import type { ApprovalSummary, TicketDetail, TicketFile, TicketSummary } from '../../../shared/protocol';
import { roleName } from '../../../shared/tickets';
import { store } from '../../state';
import { h, openModal, setDoing, toast } from '../../ui/dom';
import { markdownHtml } from '../../ui/markdown';
import { reviewHtml } from './md';

// The review table's window: what waits on the owner and what's in review on this floor, down the
// side, and the one picked beside them, read-only: an approval's request, or a ticket (its goal and
// chain log, and the files of its stages to open). Nothing is decided here: the window says where.

/** One thing in the list: an approval waiting on the owner, or a ticket. */
type Item = { kind: 'approval'; a: ApprovalSummary } | { kind: 'ticket'; t: TicketSummary };

const keyOf = (it: Item) => (it.kind === 'approval' ? `a:${it.a.id}` : `t:${it.t.folder}`);

/** A role as the floor calls it: the name on its card, else its slug written out. */
export const nameOfRole = (slug: string | undefined) => (slug ? (store.tickets.roles[slug] ?? roleName(slug)) : 'nobody');

/** `text` without the front matter it opens with: those fields are shown as a list over it. */
function body(text: string): { fields: [string, string][]; rest: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { fields: [], rest: text };
  const fields = m[1]
    .split(/\r?\n/)
    .map((l) => /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(l))
    .filter((x): x is RegExpExecArray => !!x)
    .map((x) => [x[1], x[2]] as [string, string]);
  return { fields, rest: text.slice(m[0].length) };
}

/**
 * A file's Markdown, rendered so it loads nothing (a picture or a video is its name and where it is,
 * see md.ts), each block reading in its own direction (an Arabic request right to left).
 */
function render(src: string): HTMLElement {
  const md = markdownHtml(reviewHtml(src));
  for (const el of md.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th')) el.setAttribute('dir', 'auto');
  return md;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export interface ReviewDeps {
  floor: string;
  project?: string;
  /** Open this one first: an approval (`a:<id>`) or a ticket (`t:<id>`). */
  start?: string;
}

export function openReview(deps: ReviewDeps) {
  const { floor } = deps;
  const q = (params: Record<string, string>) => new URLSearchParams({ floor, ...params }).toString();
  const side = h('aside.rv-side');
  const bar = h('div.rv-bar');
  const page = h('div.rv-page', { tabindex: -1 });
  const el = h(
    'div.modal.review',
    { role: 'dialog', 'aria-label': 'Review table' },
    h('header', {}, h('h2', {}, '🗂️ Review table', deps.project ? h('span.rv-project', {}, ` · ${deps.project}`) : '')),
    h('div.body', {}, side, h('article.rv-reader', {}, bar, page)),
    h('footer', {}, h('span.grow', {}, '👀 Read-only. Approvals are decided in the repository (approvals/pending, moved to approvals/decided), never from the office.')),
  );
  let current: string | null = null;
  let opening = 0;
  const off = store.on('tickets', () => renderList());
  const modal = openModal(el, { doing: '🗂️ at the review table', reading: true, onClose: () => off() });

  const items = () => {
    const s = store.tickets;
    return {
      waiting: s.approvals.map((a): Item => ({ kind: 'approval', a })),
      review: s.tickets.filter((t) => t.review).map((t): Item => ({ kind: 'ticket', t })),
      open: s.tickets.filter((t) => !t.review).map((t): Item => ({ kind: 'ticket', t })),
    };
  };

  const row = (it: Item) => {
    const key = keyOf(it);
    const [title, sub] =
      it.kind === 'approval'
        ? [it.a.decision ?? it.a.id, [it.a.sent, it.a.ticket].filter(Boolean).join(' · ')]
        : [it.t.title, `${it.t.stage || it.t.status} → ${nameOfRole(it.t.next)}${it.t.due ? ` · not before ${it.t.due}` : ''}`];
    const li = h('li.rv-item', { class: key === current ? 'open' : '', title: it.kind === 'approval' ? `approvals/pending/${it.a.id}.md` : `work/${it.t.folder}/ticket.md` }, h('div.rv-title', { dir: 'auto' }, title), h('div.rv-sub', {}, sub));
    li.addEventListener('click', () => void (it.kind === 'approval' ? openApproval(it.a.id) : openTicket(it.t.folder)));
    return li;
  };

  const section = (title: string, list: Item[], empty: string) => h('section.rv-section', {}, h('h3', {}, `${title} (${list.length})`), list.length ? h('ul.rv-list', {}, ...list.map(row)) : h('p.rv-none', {}, empty));

  function renderList() {
    if (!el.isConnected) return;
    const { waiting, review, open } = items();
    const more = store.tickets.more;
    side.replaceChildren(
      section('⏳ Waiting for you', waiting, 'Nothing waits on you.'),
      section('🔍 In review', review, 'Nothing is in review.'),
      section('📋 Other open tickets', open, more ? '' : 'No other open tickets.'),
      more ? h('p.rv-none', {}, `…and ${more} more open`) : '',
    );
  }

  const facts = (pairs: [string, string | undefined][]) => h('dl.rv-facts', {}, ...pairs.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v!)]));

  /** Puts `node` on the page, under a bar saying what it is (and the way back, from a stage file). */
  function show(key: string, crumbs: (string | HTMLElement)[], node: HTMLElement, doing: string) {
    current = key;
    bar.replaceChildren(...crumbs);
    page.replaceChildren(node);
    page.scrollTop = 0;
    setDoing(modal, doing);
    renderList();
  }

  async function load<T>(url: string, what: string): Promise<T | undefined> {
    const mine = ++opening;
    try {
      const r = await getJson<T>(url);
      return mine === opening && el.isConnected ? r : undefined;
    } catch (err) {
      if (mine === opening) toast(`🗂️ Couldn't open ${what}: ${(err as Error).message}`, 'warn');
      return undefined;
    }
  }

  async function openApproval(id: string) {
    const path = `approvals/pending/${id}.md`;
    const f = await load<TicketFile>(`/api/tickets/file?${q({ path })}`, path);
    if (!f) return;
    const { fields, rest } = body(f.text);
    const get = (k: string) => fields.find(([key]) => key === k)?.[1];
    const ticket = (get('ticket') ?? '').replace(/^work\//, '').replace(/\/+$/, '');
    const link = ticket ? h('button.btn.rv-link', { type: 'button' }, `📋 Open the ticket ${ticket}`) : '';
    if (link) link.addEventListener('click', () => void openTicket(ticket));
    const node = h(
      'div',
      {},
      h('p.rv-note', {}, '⏳ This waits on you. Decide in the repository: the request moves to approvals/decided once you have. Nothing here approves it.'),
      facts([
        ['Decision', get('decision_needed')],
        ['Sent', get('sent')],
      ]),
      link,
      render(rest + (f.cut ? '\n\n*(cut short)*' : '')),
    );
    show(`a:${id}`, [h('span.rv-dir', {}, 'approvals/pending/'), `${id}.md`], node, `🗂️ reading the request ${id}`);
  }

  async function openTicket(id: string) {
    const d = await load<TicketDetail>(`/api/tickets/ticket?${q({ id })}`, `the ticket ${id}`);
    if (!d) return;
    const { fields, rest } = body(d.text);
    const get = (k: string) => fields.find(([key]) => key === k)?.[1];
    const files = h(
      'div.rv-files',
      {},
      h('span.rv-files-label', {}, 'Stage files:'),
      ...d.files
        .filter((f) => f.name !== 'ticket.md')
        .map((f) => {
          const b = h('button.btn.rv-file', { type: 'button', title: `${f.size} bytes` }, `📄 ${f.name}`);
          b.addEventListener('click', () => void openFile(id, f.name));
          return b;
        }),
    );
    if (d.files.length <= 1) files.append(h('span.rv-none', {}, 'none yet'));
    const node = h(
      'div',
      {},
      facts([
        ['Stage', get('stage')],
        ['Status', get('status')],
        ['Next', get('next_role') ? nameOfRole(get('next_role')) : undefined],
        ['Due', get('due')],
        ['Line', get('line')],
      ]),
      files,
      render(rest),
    );
    show(`t:${id}`, [h('span.rv-dir', {}, 'work/'), `${id}/ticket.md`], node, `🗂️ reading the ticket ${id}`);
  }

  async function openFile(id: string, name: string) {
    const path = `work/${id}/${name}`;
    const f = await load<TicketFile>(`/api/tickets/file?${q({ path })}`, name);
    if (!f) return;
    const back = h('button.btn.rv-back', { type: 'button' }, '← Ticket');
    back.addEventListener('click', () => void openTicket(id));
    show(`t:${id}`, [back, h('span.rv-dir', {}, `work/${id}/`), name], render(body(f.text).rest + (f.cut ? '\n\n*(cut short)*' : '')), `🗂️ reading ${name}`);
  }

  renderList();
  const { waiting, review, open } = items();
  const first = deps.start ?? [...waiting, ...review, ...open].map(keyOf)[0];
  if (first?.startsWith('a:')) void openApproval(first.slice(2));
  else if (first?.startsWith('t:')) void openTicket(first.slice(2));
  else page.replaceChildren(h('div.rv-empty', {}, '📭 Nothing open on this floor.'));
}
