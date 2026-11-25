/**
 * The Watch window: a visitor's session as it happens, over its shoulder. The prompts it was given,
 * what it wrote and thought, each tool call with what it was asked to do (a change as a diff, a
 * command with its output), a tab for each of its subagents. It keeps to the bottom while you're
 * there, and stays put while you scroll back. Only to look at: nothing in it reaches the session.
 */
import './ui.css';
import '../../ui/termtabs.css';
import type { Visitor, VisitorApp, WatchAgent, WatchItem } from '../../../shared/protocol';
import { claudeModelName } from '../../../shared/providers';
import { STATUS_LABEL, h, openModal } from '../../ui/dom';
import { markdown } from '../../ui/markdown';
import { subagentColor } from '../../world/character/subagent';

/** A tab keeps at most this many items on the page; older ones go. */
const ITEMS_KEPT = 500;
/** A block longer than this many lines shows only its start, with a button for the rest. */
const CLAMP_LINES = 14;
/** How close to the bottom (px) still counts as at the bottom, for following what's new. */
const NEAR_BOTTOM = 40;

const APP: Record<VisitorApp, string> = { desktop: '🖥️ Claude app', cli: '⌨️ Terminal', ide: '🧩 IDE', other: '🤖 Claude Code' };

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
  return at ? h('time.vw-time', {}, new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })) : null;
}

/** How much of a body the office left off, if any. */
function cutNote(it: WatchItem): HTMLElement | null {
  return it.cut ? h('div.vw-cut', {}, `… and ${it.cut.toLocaleString()} more characters, not shown`) : null;
}

/** A block of text in the office's terminal colors: a diff's lines colored, and a long one folded to its start. */
function codeBlock(body: string, diff: boolean, kind: 'code' | 'out' | 'err' = 'code'): HTMLElement {
  const lines = body.split('\n');
  const pre = h('pre.vw-code', { class: kind });
  if (diff) {
    for (const l of lines) pre.append(h('span', { class: l.startsWith('+ ') ? 'add' : l.startsWith('- ') ? 'del' : l === '@@' ? 'hunk' : 'ctx' }, `${l}\n`));
  } else pre.textContent = body;
  if (lines.length <= CLAMP_LINES) return pre;
  pre.classList.add('clamped');
  const more = h('button.vw-more', { type: 'button' }, `Show all ${lines.length} lines`);
  more.addEventListener('click', () => {
    const open = pre.classList.toggle('clamped');
    more.textContent = open ? `Show all ${lines.length} lines` : 'Show less';
  });
  return h('div.vw-block', {}, pre, more);
}

/** Plain text that keeps its line breaks, folded like a code block when it's long. */
function textBlock(body: string): HTMLElement {
  const lines = body.split('\n');
  const el = h('div.vw-text', {}, body);
  if (lines.length <= CLAMP_LINES) return el;
  el.classList.add('clamped');
  const more = h('button.vw-more', { type: 'button' }, 'Show all');
  more.addEventListener('click', () => {
    const open = el.classList.toggle('clamped');
    more.textContent = open ? 'Show all' : 'Show less';
  });
  return h('div.vw-block', {}, el, more);
}

/** An item as the page shows it, or null when it went under the tool call it answers. */
function itemEl(it: WatchItem, tab: Tab): HTMLElement | null {
  switch (it.kind) {
    case 'prompt':
      return h('div.vw-item.vw-prompt', {}, h('div.vw-label', {}, '🧑 Prompt', clock(it.at)), textBlock(it.body ?? ''), cutNote(it));
    case 'text':
      return h('div.vw-item.vw-say', {}, markdown(it.body ?? ''), cutNote(it));
    case 'think':
      return h('details.vw-item.vw-think', {}, h('summary', {}, '💭 Thinking', clock(it.at)), textBlock(it.body ?? ''), cutNote(it));
    case 'tool': {
      const asks = it.tool === 'AskUserQuestion' || it.tool === 'ExitPlanMode';
      const card = h(
        'div.vw-item.vw-tool',
        { class: asks ? 'ask' : '' },
        h('div.vw-head', {}, h('span.vw-icon', { 'aria-hidden': 'true' }, ICON[it.tool ?? ''] ?? '🔧'), h('span.vw-cmd', {}, it.head ?? it.tool ?? 'Tool'), clock(it.at)),
        it.sub ? h('div.vw-sub', {}, it.sub) : null,
        it.body ? (it.diff || it.tool !== 'Agent' ? codeBlock(it.body, !!it.diff) : textBlock(it.body)) : null,
        cutNote(it),
      );
      if (it.id) tab.tools.set(it.id, card);
      return card;
    }
    case 'result': {
      const out = codeBlock(it.body?.trim() ? it.body : '(no output)', false, it.error ? 'err' : 'out');
      const card = it.id ? tab.tools.get(it.id) : undefined;
      if (card?.isConnected) {
        card.append(out);
        const cut = cutNote(it);
        if (cut) card.append(cut);
        return null;
      }
      return h('div.vw-item.vw-result', {}, h('div.vw-label', {}, it.error ? '❌ Failed' : '↳ Result', clock(it.at)), out, cutNote(it));
    }
    case 'note':
      return h('div.vw-note', {}, it.head ?? '');
  }
}

/** Opens the Watch window on `v`. `onClose` runs once it's closed, however that happened. */
export function openWatchWindow(v: Visitor, onClose: () => void): WatchView {
  const title = h('h2', {}, `👀 ${v.title}`);
  const pill = h('span.pill', {});
  const meta = h('span.vw-meta', {});
  const tabsEl = h('div.term-tabs', { role: 'tablist', 'aria-label': 'Session and subagents' });
  const bar = h('div.term-tabbar.vw-tabbar', {}, tabsEl, h('span.vw-ro', { title: 'Read off its transcript as it is written. Nothing here can type into it or stop it.' }, '🔒 Read only'));
  const body = h('div.vw-body', {});
  const jump = h('button.btn.vw-jump.hidden', { type: 'button', title: 'Back to the newest, and keep to it' }, '↓ Latest');
  const status = h('span.grow', {}, 'Connecting…');
  const el = h(
    'div.modal.vwatch',
    { role: 'dialog', 'aria-label': `Watching ${v.title}` },
    h('header', {}, h('span.dot', { style: `background:${subagentColor(v.id)}` }), title, pill, meta),
    bar,
    h('div.vw-main', {}, body, jump),
    h('footer', {}, status),
  );
  const tabs = new Map<string, Tab>();
  /** What the session's tab says while there's nothing in it. */
  const empty = h('div.vw-note', {}, 'Nothing to show yet: what it does next comes up here.');
  let active = '';
  let ended = false;
  let gotAny = false;

  const atBottom = (pane: HTMLElement) => pane.scrollHeight - pane.scrollTop - pane.clientHeight < NEAR_BOTTOM;
  const showJump = () => {
    const tab = tabs.get(active);
    jump.classList.toggle('hidden', !tab || tab.follow);
  };

  function tabFor(id: string, label: string): Tab {
    const had = tabs.get(id);
    if (had) return had;
    const btn = h('button.term-tab-label', { type: 'button', role: 'tab' }, label) as HTMLButtonElement;
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
    for (const t of tabs.values()) {
      const on = t.id === id;
      t.wrap.classList.toggle('on', on);
      t.btn.setAttribute('aria-selected', String(on));
      t.pane.classList.toggle('hidden', !on);
      if (on) t.wrap.classList.remove('unread');
    }
    const tab = tabs.get(id);
    if (tab?.follow) tab.pane.scrollTop = tab.pane.scrollHeight;
    showJump();
  }

  const agentLabel = (a: WatchAgent) => `🤖 ${a.title ?? a.type}${a.live ? '' : ' ✓'}`;

  function render(cur: Visitor | undefined) {
    if (!cur) return;
    title.textContent = `👀 ${cur.title}`;
    pill.className = `pill ${ended ? 'done' : cur.status}`;
    pill.textContent = ended ? 'Left' : (STATUS_LABEL[cur.status] ?? cur.status);
    meta.textContent = [APP[cur.app], `${cur.folder}${cur.branch ? ` (${cur.branch})` : ''}`, cur.model && (claudeModelName(cur.model) ?? cur.model)].filter(Boolean).join(' · ');
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
      for (const t of tabs.values()) {
        t.pane.replaceChildren();
        t.tools.clear();
        t.follow = true;
      }
    }
    tabFor('', '💬 Session');
    for (const a of agents) tabFor(a.id, agentLabel(a)).btn.textContent = agentLabel(a);
    const touched = new Set<Tab>();
    for (const it of items) {
      const tab = tabFor(it.agent ?? '', it.agent ? `🤖 ${it.agent}` : '💬 Session');
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
    if (!ended) status.textContent = 'Live: read off its transcript as it is written, about once a second.';
    showJump();
  }

  jump.addEventListener('click', () => {
    const tab = tabs.get(active);
    if (!tab) return;
    tab.follow = true;
    tab.pane.scrollTop = tab.pane.scrollHeight;
    showJump();
  });

  const modal = openModal(el, { doing: `👀 watching ${v.title}`, backdropCloses: true, onClose });
  render(v);

  return {
    feed,
    gone() {
      ended = true;
      status.textContent = gotAny ? 'This session has left the office: that is all of it.' : 'This session has left the office.';
      pill.className = 'pill done';
      pill.textContent = 'Left';
    },
    visitor: render,
    close: () => modal.close(),
  };
}
