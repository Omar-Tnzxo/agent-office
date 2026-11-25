/**
 * The Watch window: a visitor's session as it happens, over its shoulder. The prompts it was given,
 * what it wrote and thought, each tool call with what it was asked to do (a change as a diff, a
 * command with its output), a tab for each of its subagents. It keeps to the bottom while you're
 * there, and stays put while you scroll back. Only to look at: nothing in it reaches the session.
 * Its own words are in the viewer's language; what the session wrote reads in its own direction, and
 * code, diffs and output stay left to right.
 */
import './ui.css';
import '../../ui/termtabs.css';
import type { Visitor, VisitorApp, WatchAgent, WatchItem } from '../../../shared/protocol';
import { claudeModelName } from '../../../shared/providers';
import { labels, ltrText, t, tn, time } from '../../i18n';
import { toolText } from '../../i18n/server';
import { STATUS_LABEL, h, openModal } from '../../ui/dom';
import { transcriptMarkdown } from './markdown';
import { subagentColor } from '../../world/character/subagent';

/** A tab keeps at most this many items on the page; older ones go. */
const ITEMS_KEPT = 500;
/** A block longer than this many lines shows only its start, with a button for the rest. */
const CLAMP_LINES = 14;
/** How close to the bottom (px) still counts as at the bottom, for following what's new. */
const NEAR_BOTTOM = 40;

const APP = labels<VisitorApp>({ desktop: 'desks.visitor.app.desktop', cli: 'desks.visitor.app.cli', ide: 'desks.visitor.app.ide', other: 'desks.visitor.app.other' });

const ICON: Record<string, string> = {
  Bash: '⌨️',
  Edit: '✏️',
  MultiEdit: '✏️',
  NotebookEdit: '✏️',
  Write: '📝',
  Read: '📖',
  Grep: '🔎',
  Glob: '🔎',
  WebFetch: '🌐',
  WebSearch: '🌐',
  Agent: '🤖',
  Task: '🤖',
  TodoWrite: '☑️',
  AskUserQuestion: '⏳',
  ExitPlanMode: '⏳',
};

export interface WatchView {
  /** What the office sent: everything there is so far (`reset`), or what's new since. */
  feed(items: readonly WatchItem[], agents: readonly WatchAgent[], reset: boolean): void;
  /** The visitor left the office: its feed ends here. */
  gone(): void;
  /** The visitor as the floor last heard of it (undefined: it isn't listed on this floor now). */
  visitor(v: Visitor | undefined): void;
  /** The window's own words again, in the language now (what's in it comes again from the office). */
  relabel(): void;
  close(): void;
}

/** One tab: the session itself (id '') or one of its subagents, with its own page and scroll. */
interface Tab {
  id: string;
  btn: HTMLButtonElement;
  wrap: HTMLElement;
  pane: HTMLElement;
  /** Tool calls on the page by id, for their results to go under. */
  tools: Map<string, HTMLElement>;
  /** Keeping to the bottom: you're there, or haven't scrolled away from it. */
  follow: boolean;
}

/** "14:03:22" for an item's time. */
function clock(at?: number): HTMLElement | null {
  return at ? h('time.vw-time', {}, time(at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })) : null;
}

/** How much of a body the office left off, if any. */
function cutNote(it: WatchItem): HTMLElement | null {
  return it.cut ? h('div.vw-cut', {}, tn('watch.cut', it.cut)) : null;
}

/** A block of text in the office's terminal colors: a diff's lines colored, and a long one folded to its start. */
function codeBlock(body: string, diff: boolean, kind: 'code' | 'out' | 'err' = 'code'): HTMLElement {
  const lines = body.split('\n');
  const pre = h('pre.vw-code', { class: kind, dir: 'ltr' });
  if (diff) {
    for (const l of lines) pre.append(h('span', { class: l.startsWith('+ ') ? 'add' : l.startsWith('- ') ? 'del' : l === '@@' ? 'hunk' : 'ctx' }, `${l}\n`));
  } else pre.textContent = body;
  if (lines.length <= CLAMP_LINES) return pre;
  pre.classList.add('clamped');
  const all = tn('watch.showLines', lines.length);
  const more = h('button.vw-more', { type: 'button' }, all);
  more.addEventListener('click', () => {
    const open = pre.classList.toggle('clamped');
    more.textContent = open ? all : t('watch.showLess');
  });
  return h('div.vw-block', {}, pre, more);
}

/** Plain text that keeps its line breaks and reads in its own direction, folded like a code block when it's long. */
function textBlock(body: string): HTMLElement {
  const lines = body.split('\n');
  const el = h('div.vw-text', { dir: 'auto' }, body);
  if (lines.length <= CLAMP_LINES) return el;
  el.classList.add('clamped');
  const more = h('button.vw-more', { type: 'button' }, t('watch.showAll'));
  more.addEventListener('click', () => {
    const open = el.classList.toggle('clamped');
    more.textContent = open ? t('watch.showAll') : t('watch.showLess');
  });
  return h('div.vw-block', {}, el, more);
}

/** What the session wrote, as Markdown, each block in its own direction (an Arabic reply right to left). */
function said(body: string): HTMLElement {
  const md = transcriptMarkdown(body);
  for (const el of md.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, table, td, th')) el.setAttribute('dir', 'auto');
  return md;
}

/** An item as the page shows it, or null when it went under the tool call it answers. */
function itemEl(it: WatchItem, tab: Tab): HTMLElement | null {
  switch (it.kind) {
    case 'prompt':
      return h('div.vw-item.vw-prompt', {}, h('div.vw-label', {}, t('watch.prompt'), clock(it.at)), textBlock(it.body ?? ''), cutNote(it));
    case 'text':
      // Never the app's markdown(): nothing a transcript says may load from the network (see ./markdown.ts).
      return h('div.vw-item.vw-say', {}, said(it.body ?? ''), cutNote(it));
    case 'think':
      return h('details.vw-item.vw-think', {}, h('summary', {}, t('watch.thinking'), clock(it.at)), textBlock(it.body ?? ''), cutNote(it));
    case 'tool': {
      const asks = it.tool === 'AskUserQuestion' || it.tool === 'ExitPlanMode';
      const card = h(
        'div.vw-item.vw-tool',
        { class: asks ? 'ask' : '' },
        h('div.vw-head', {}, h('span.vw-icon', { 'aria-hidden': 'true' }, ICON[it.tool ?? ''] ?? '🔧'), h('span.vw-cmd', { dir: 'auto' }, it.head ? toolText(it.head) : (it.tool ?? t('watch.tool'))), clock(it.at)),
        it.sub ? h('div.vw-sub', { dir: 'auto' }, it.sub) : null,
        it.body ? (it.diff || it.tool !== 'Agent' ? codeBlock(it.body, !!it.diff) : textBlock(it.body)) : null,
        cutNote(it),
      );
      if (it.id) tab.tools.set(it.id, card);
      return card;
    }
    case 'result': {
      const out = codeBlock(it.body?.trim() ? it.body : t('watch.noOutput'), false, it.error ? 'err' : 'out');
      const card = it.id ? tab.tools.get(it.id) : undefined;
      if (card?.isConnected) {
        card.append(out);
        const cut = cutNote(it);
        if (cut) card.append(cut);
        return null;
      }
      return h('div.vw-item.vw-result', {}, h('div.vw-label', {}, t(it.error ? 'watch.failed' : 'watch.result'), clock(it.at)), out, cutNote(it));
    }
    case 'note':
      return h('div.vw-note', {}, toolText(it.head ?? ''));
  }
}

/** Opens the Watch window on `v`. `onClose` runs once it's closed, however that happened. */
export function openWatchWindow(v: Visitor, onClose: () => void): WatchView {
  const title = h('h2', { dir: 'auto' }, `👀 ${v.title}`);
  const pill = h('span.pill', {});
  const meta = h('span.vw-meta', {});
  const tabsEl = h('div.term-tabs', { role: 'tablist' });
  const ro = h('span.vw-ro', {});
  const bar = h('div.term-tabbar.vw-tabbar', {}, tabsEl, ro);
  const body = h('div.vw-body', {});
  const jump = h('button.btn.vw-jump.hidden', { type: 'button' });
  const status = h('span.grow', {});
  const el = h(
    'div.modal.vwatch',
    { role: 'dialog' },
    h('header', {}, h('span.dot', { style: `background:${subagentColor(v.id)}` }), title, pill, meta),
    bar,
    h('div.vw-main', {}, body, jump),
    h('footer', {}, status),
  );
  const tabs = new Map<string, Tab>();
  /** What the session's tab says while there's nothing in it. */
  const empty = h('div.vw-note', {});
  let active = '';
  let ended = false;
  let gotAny = false;
  /** Whether the office has sent anything yet (the footer says Connecting… till then). */
  let live = false;
  let cur: Visitor | undefined = v;

  const atBottom = (pane: HTMLElement) => pane.scrollHeight - pane.scrollTop - pane.clientHeight < NEAR_BOTTOM;
  const showJump = () => {
    const tab = tabs.get(active);
    jump.classList.toggle('hidden', !tab || tab.follow);
  };

  function tabFor(id: string, label: string): Tab {
    const had = tabs.get(id);
    if (had) return had;
    const btn = h('button.term-tab-label', { type: 'button', role: 'tab', dir: 'auto' }, label) as HTMLButtonElement;
    const wrap = h('div.term-tab', {}, btn);
    const pane = h('div.vw-pane.hidden', { role: 'tabpanel', 'aria-label': label, tabindex: '0' });
    const tab: Tab = { id, btn, wrap, pane, tools: new Map(), follow: true };
    pane.addEventListener('scroll', () => {
      tab.follow = atBottom(pane);
      if (tab.id === active) showJump();
    });
    btn.addEventListener('click', () => select(id));
    tabs.set(id, tab);
    tabsEl.append(wrap);
    body.append(pane);
    if (tabs.size === 1) select(id);
    return tab;
  }

  function select(id: string) {
    active = id;
    for (const tb of tabs.values()) {
      const on = tb.id === id;
      tb.wrap.classList.toggle('on', on);
      tb.btn.setAttribute('aria-selected', String(on));
      tb.pane.classList.toggle('hidden', !on);
      if (on) tb.wrap.classList.remove('unread');
    }
    const tab = tabs.get(id);
    if (tab?.follow) tab.pane.scrollTop = tab.pane.scrollHeight;
    showJump();
  }

  const agentLabel = (a: WatchAgent) => `🤖 ${a.title ?? a.type}${a.live ? '' : ' ✓'}`;

  function render(next: Visitor | undefined) {
    if (!next) return;
    cur = next;
    title.textContent = `👀 ${next.title}`;
    el.setAttribute('aria-label', t('watch.aria', { title: next.title }));
    pill.className = `pill ${ended ? 'done' : next.status}`;
    pill.textContent = ended ? t('watch.left') : (STATUS_LABEL[next.status] ?? next.status);
    meta.textContent = [APP[next.app], ltrText(`${next.folder}${next.branch ? ` (${next.branch})` : ''}`), next.model && (claudeModelName(next.model) ?? next.model)].filter(Boolean).join(' · ');
  }

  /** The footer: connecting, live, or what's left of a session that went. */
  function footer() {
    if (ended) status.textContent = t(gotAny ? 'watch.goneAll' : 'watch.goneNone');
    else status.textContent = t(live ? 'watch.live' : 'watch.connecting');
  }

  /** The window's own words, in the language now. */
  function relabel() {
    tabsEl.setAttribute('aria-label', t('watch.tabsAria'));
    ro.title = t('watch.readOnlyTitle');
    ro.textContent = t('watch.readOnly');
    jump.title = t('watch.jumpTitle');
    jump.textContent = t('watch.jump');
    empty.textContent = t('watch.empty');
    const main = tabs.get('');
    if (main) main.btn.textContent = t('watch.session');
    render(cur);
    footer();
  }

  /** Trims a tab to ITEMS_KEPT items, forgetting the tool calls that went with them. */
  function trim(tab: Tab) {
    const extra = tab.pane.children.length - ITEMS_KEPT;
    if (extra <= 0) return;
    for (let i = 0; i < extra; i++) tab.pane.firstElementChild?.remove();
    for (const [id, card] of tab.tools) if (!card.isConnected) tab.tools.delete(id);
  }

  function feed(items: readonly WatchItem[], agents: readonly WatchAgent[], reset: boolean) {
    if (reset) {
      for (const tb of tabs.values()) {
        tb.pane.replaceChildren();
        tb.tools.clear();
        tb.follow = true;
      }
    }
    tabFor('', t('watch.session'));
    // A subagent the office no longer follows takes its tab with it (the session's stays).
    const listed = new Set(agents.map((a) => a.id));
    for (const tb of [...tabs.values()]) {
      if (!tb.id || listed.has(tb.id)) continue;
      tb.wrap.remove();
      tb.pane.remove();
      tabs.delete(tb.id);
      if (active === tb.id) select('');
    }
    for (const a of agents) tabFor(a.id, agentLabel(a)).btn.textContent = agentLabel(a);
    const touched = new Set<Tab>();
    for (const it of items) {
      if (it.agent && !listed.has(it.agent)) continue;
      const tab = tabFor(it.agent ?? '', it.agent ? `🤖 ${it.agent}` : t('watch.session'));
      const node = itemEl(it, tab);
      if (node) tab.pane.append(node);
      touched.add(tab);
    }
    for (const tab of touched) {
      trim(tab);
      if (tab.follow) tab.pane.scrollTop = tab.pane.scrollHeight;
      if (tab.id !== active && !reset) tab.wrap.classList.add('unread');
    }
    gotAny ||= reset || items.length > 0;
    const main = tabs.get('')!;
    if (main.pane.children.length > 1) empty.remove();
    else if (!main.pane.children.length) main.pane.append(empty);
    live = true;
    footer();
    showJump();
  }

  jump.addEventListener('click', () => {
    const tab = tabs.get(active);
    if (!tab) return;
    tab.follow = true;
    tab.pane.scrollTop = tab.pane.scrollHeight;
    showJump();
  });

  // What you're doing goes to the others in English; each of them reads it in their own language (i18n/server.ts).
  const modal = openModal(el, { doing: `👀 watching ${v.title}`, backdropCloses: true, onClose });
  relabel();

  return {
    feed,
    gone() {
      ended = true;
      footer();
      pill.className = 'pill done';
      pill.textContent = t('watch.left');
    },
    visitor: render,
    relabel() {
      // What's in it comes again (see installVisitorWatch): it says Connecting… till then.
      live = false;
      relabel();
    },
    close: () => modal.close(),
  };
}
