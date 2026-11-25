import './ui.css';
import type { ApprovalSummary, TicketDetail, TicketFile, TicketSummary } from '../../../shared/protocol';
import { roleName } from '../../../shared/tickets';
import { ltrText, onLang, t, tn } from '../../i18n';
import { ltr } from '../../i18n/dom';
import { serverText } from '../../i18n/server';
import { store } from '../../state';
import { h, openModal, setDoing, toast } from '../../ui/dom';
import { markdownHtml } from '../../ui/markdown';
import { reviewHtml } from './md';

// The review table's window: what waits on the owner and what's in review on this floor, down the
// side, and the one picked beside them, read-only: an approval's request, or a ticket (its goal and
// chain log, and the files of its stages to open). Nothing is decided here: the window says where.
// Its own words are in the viewer's language; a ticket's text, stages and roles are as the files
// have them, each block reading in its own direction, and paths left to right.

/** One thing in the list: an approval waiting on the owner, or a ticket. */
type Item = { kind: 'approval'; a: ApprovalSummary } | { kind: 'ticket'; t: TicketSummary };

const keyOf = (it: Item) => (it.kind === 'approval' ? `a:${it.a.id}` : `t:${it.t.folder}`);

/** A role as the floor calls it: the name on its card, else its slug written out. */
export const nameOfRole = (slug: string | undefined) => (slug ? (store.tickets.roles[slug] ?? roleName(slug)) : t('tickets.nobody'));

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

/** The note a file cut short ends with. */
const cutShort = (cut: boolean | undefined) => (cut ? `\n\n*(${t('tickets.cutShort')})*` : '');

/**
 * A file's Markdown, rendered so it loads nothing (a picture or a video is its name and where it is,
 * see md.ts), each block reading in its own direction (an Arabic request right to left).
 */
function render(src: string): HTMLElement {
  const md = markdownHtml(reviewHtml(src));
  // A table too: an English chain log keeps When on the left, an Arabic one runs from the right.
  for (const el of md.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, table, td, th')) el.setAttribute('dir', 'auto');
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
  const heading = h('h2', {});
  const foot = h('span.grow', {});
  const el = h('div.modal.review', { role: 'dialog' }, h('header', {}, heading), h('div.body', {}, side, h('article.rv-reader', {}, bar, page)), h('footer', {}, foot));
  let current: string | null = null;
  let opening = 0;
  /** What's open, to open again in the language now after a switch. */
  let again: (() => void) | null = null;

  function words() {
    el.setAttribute('aria-label', t('tickets.name'));
    heading.replaceChildren(`🗂️ ${t('tickets.name')}`, deps.project ? h('span.rv-project', {}, ' · ', ltr(deps.project)) : '');
    foot.textContent = t('tickets.window.foot');
  }
  words();
  const offTickets = store.on('tickets', () => renderList());
  const offLang = onLang(() => {
    words();
    renderList();
    again?.();
  });
  // What you're doing goes to the others in English; each of them reads it in their own language (i18n/server.ts).
  const modal = openModal(el, {
    doing: '🗂️ at the review table',
    reading: true,
    onClose: () => {
      offTickets();
      offLang();
    },
  });

  const items = () => {
    const s = store.tickets;
    return {
      waiting: s.approvals.map((a): Item => ({ kind: 'approval', a })),
      review: s.tickets.filter((tk) => tk.review).map((tk): Item => ({ kind: 'ticket', t: tk })),
      open: s.tickets.filter((tk) => !tk.review).map((tk): Item => ({ kind: 'ticket', t: tk })),
    };
  };

  const row = (it: Item) => {
    const key = keyOf(it);
    const [title, sub] =
      it.kind === 'approval'
        ? [it.a.decision ?? it.a.id, [it.a.sent, it.a.ticket].filter(Boolean).join(' · ')]
        : [it.t.title, [t('tickets.row.next', { stage: ltrText(it.t.stage || it.t.status), role: ltrText(nameOfRole(it.t.next)) }), it.t.due ? t('tickets.row.due', { due: ltrText(it.t.due) }) : ''].filter(Boolean).join(' · ')];
    const li = h(
      'li.rv-item',
      { class: key === current ? 'open' : '', title: it.kind === 'approval' ? `approvals/pending/${it.a.id}.md` : `work/${it.t.folder}/ticket.md` },
      h('div.rv-title', { dir: 'auto' }, title),
      // An approval's line is the file's own words; a ticket's is the window's ("stage → role"), in the page's direction.
      h('div.rv-sub', it.kind === 'approval' ? { dir: 'auto' } : {}, sub),
    );
    li.addEventListener('click', () => void (it.kind === 'approval' ? openApproval(it.a.id) : openTicket(it.t.folder)));
    return li;
  };

  const section = (title: string, list: Item[], empty: string) => h('section.rv-section', {}, h('h3', {}, title), list.length ? h('ul.rv-list', {}, ...list.map(row)) : h('p.rv-none', {}, empty));

  function renderList() {
    if (!el.isConnected) return;
    const { waiting, review, open } = items();
    const more = store.tickets.more;
    side.replaceChildren(
      section(t('tickets.section.waiting', { n: waiting.length }), waiting, t('tickets.empty.waiting')),
      section(t('tickets.section.review', { n: review.length }), review, t('tickets.empty.review')),
      section(t('tickets.section.open', { n: open.length }), open, more ? '' : t('tickets.empty.open')),
      more ? h('p.rv-none', {}, tn('tickets.more', more)) : '',
    );
  }

  const facts = (pairs: [string, string | undefined][]) => h('dl.rv-facts', {}, ...pairs.filter(([, v]) => v).flatMap(([k, v]) => [h('dt', {}, k), h('dd', { dir: 'auto' }, v!)]));

  /** Puts `node` on the page, under a bar saying what it is (and the way back, from a stage file). */
  function show(key: string, crumbs: (string | HTMLElement)[], node: HTMLElement, doing: string, reopen: () => void) {
    current = key;
    again = reopen;
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
      if (mine === opening) toast(t('tickets.openFailed', { what, why: serverText((err as Error).message) }), 'warn');
      return undefined;
    }
  }

  /** A path in the bar over the page: it reads left to right in either language. */
  const path = (dir: string, name: string) => h('bdi.rv-path', { dir: 'ltr' }, h('span.rv-dir', {}, dir), name);

  async function openApproval(id: string) {
    const file = `approvals/pending/${id}.md`;
    const f = await load<TicketFile>(`/api/tickets/file?${q({ path: file })}`, file);
    if (!f) return;
    const { fields, rest } = body(f.text);
    const get = (k: string) => fields.find(([key]) => key === k)?.[1];
    const ticket = (get('ticket') ?? '').replace(/^work\//, '').replace(/\/+$/, '');
    const link = ticket ? h('button.btn.rv-link', { type: 'button' }, t('tickets.openTicket', { id: ltrText(ticket) })) : '';
    if (link) link.addEventListener('click', () => void openTicket(ticket));
    const node = h(
      'div',
      {},
      h('p.rv-note', {}, t('tickets.approvalNote')),
      facts([
        [t('tickets.fact.decision'), get('decision_needed')],
        [t('tickets.fact.sent'), get('sent')],
      ]),
      link,
      render(rest + cutShort(f.cut)),
    );
    show(`a:${id}`, [path('approvals/pending/', `${id}.md`)], node, `🗂️ reading the request ${id}`, () => void openApproval(id));
  }

  async function openTicket(id: string) {
    const d = await load<TicketDetail>(`/api/tickets/ticket?${q({ id })}`, t('tickets.theTicket', { id: ltrText(id) }));
    if (!d) return;
    const { fields, rest } = body(d.text);
    const get = (k: string) => fields.find(([key]) => key === k)?.[1];
    const files = h(
      'div.rv-files',
      {},
      h('span.rv-files-label', {}, t('tickets.stageFiles')),
      ...d.files
        .filter((f) => f.name !== 'ticket.md')
        .map((f) => {
          const b = h('button.btn.rv-file', { type: 'button', title: tn('tickets.bytes', f.size) }, '📄 ', ltr(f.name));
          b.addEventListener('click', () => void openFile(id, f.name));
          return b;
        }),
    );
    if (d.files.length <= 1) files.append(h('span.rv-none', {}, t('tickets.noneYet')));
    const node = h(
      'div',
      {},
      facts([
        [t('tickets.fact.stage'), get('stage')],
        [t('tickets.fact.status'), get('status')],
        [t('tickets.fact.next'), get('next_role') ? nameOfRole(get('next_role')) : undefined],
        [t('tickets.fact.due'), get('due')],
        [t('tickets.fact.line'), get('line')],
      ]),
      files,
      render(rest),
    );
    show(`t:${id}`, [path('work/', `${id}/ticket.md`)], node, `🗂️ reading the ticket ${id}`, () => void openTicket(id));
  }

  async function openFile(id: string, name: string) {
    const file = `work/${id}/${name}`;
    const f = await load<TicketFile>(`/api/tickets/file?${q({ path: file })}`, name);
    if (!f) return;
    const back = h('button.btn.rv-back', { type: 'button' }, t('tickets.back'));
    back.addEventListener('click', () => void openTicket(id));
    show(`t:${id}`, [back, path(`work/${id}/`, name)], render(body(f.text).rest + cutShort(f.cut)), `🗂️ reading ${name}`, () => void openFile(id, name));
  }

  /** The page with nothing on it, in the language now. */
  function nothing() {
    again = nothing;
    page.replaceChildren(h('div.rv-empty', {}, t('tickets.nothingOpen')));
  }

  renderList();
  const { waiting, review, open } = items();
  const first = deps.start ?? [...waiting, ...review, ...open].map(keyOf)[0];
  if (first?.startsWith('a:')) void openApproval(first.slice(2));
  else if (first?.startsWith('t:')) void openTicket(first.slice(2));
  else nothing();
}
