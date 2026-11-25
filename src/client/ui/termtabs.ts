// Tabs on a worker's terminal: the terminal itself, plus any web pages pinned open beside it (a
// linked chat, docs for the task). They're this browser's own: nothing goes to the office or to
// anyone else, and they're kept per worker until the page reloads.
import './termtabs.css';
import { clip, h, toast } from './dom';
import { t } from '../i18n';

/** A web page pinned open beside a worker's terminal. */
interface WebTab {
  id: string;
  title: string;
  url: string;
}

/** Web tabs survive closing and reopening a worker's terminal, until the page reloads. */
const tabsByWorker = new Map<string, WebTab[]>();

/**
 * What a pinned page may do in its frame: run, sign in, send forms and open links in a new tab,
 * but never navigate the office's own tab away, or reach camera, mic or clipboard.
 */
const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';

export interface TermTabsOptions {
  /** The terminal's own area and keypad, hidden while a web page shows. */
  host: HTMLElement;
  keypad: HTMLElement | null;
  /** Back on the terminal's tab. */
  focusTerm(): void;
}

/** The tab bar (above the terminal) and where the pages show (beside it). */
export function termTabs(workerId: string, opts: TermTabsOptions): { bar: HTMLElement; pages: HTMLElement } {
  const tabsBar = h('div.term-tabs', { role: 'tablist', 'aria-label': t('work.tabs.aria') });
  const tabName = h('input', { type: 'text', placeholder: t('work.tabs.namePlaceholder'), 'aria-label': t('work.tabs.nameAria'), maxlength: '40', autocomplete: 'off' }) as HTMLInputElement;
  const tabUrl = h('input.ltr', { type: 'url', placeholder: 'https://…', 'aria-label': t('work.tabs.urlAria'), autocomplete: 'off' }) as HTMLInputElement;
  const cancelBtn = h('button.btn', { type: 'button' }, t('common.cancel'));
  const form = h('form.term-tab-form.hidden', {}, tabName, tabUrl, h('button.btn.primary', { type: 'submit' }, t('work.tabs.add')), cancelBtn);
  const addBtn = h('button.term-tab-add', { type: 'button', title: t('work.tabs.addTitle') }, t('work.tabs.addBtn'));
  // Plenty of sites won't show inside another page (chatgpt.com doesn't): this opens the one showing in a tab of its own.
  const openOut = h('a.term-tab-out.hidden', { target: '_blank', rel: 'noopener noreferrer', title: t('work.tabs.outTitle') }, t('work.tabs.out')) as HTMLAnchorElement;
  const bar = h('div.term-tabbar', {}, tabsBar, openOut, addBtn, form);
  const pages = h('div.term-webhost.hidden');

  const tabs = tabsByWorker.get(workerId) ?? [];
  tabsByWorker.set(workerId, tabs);
  const frames = new Map<string, HTMLIFrameElement>();
  let active = 'main';

  const render = () => {
    const mainTab = h('div.term-tab', { class: active === 'main' ? 'on' : '' }, h('button.term-tab-label', { type: 'button', role: 'tab', 'aria-selected': String(active === 'main'), onclick: () => show('main') }, t('work.tabs.terminal')));
    tabsBar.replaceChildren(
      mainTab,
      ...tabs.map((tab) =>
        h(
          'div.term-tab',
          { class: active === tab.id ? 'on' : '' },
          h('button.term-tab-label', { type: 'button', role: 'tab', 'aria-selected': String(active === tab.id), title: tab.url, onclick: () => show(tab.id) }, `🌐 ${clip(tab.title, 18)}`),
          h(
            'button.term-tab-close',
            {
              type: 'button',
              'aria-label': t('work.tabs.closeAria', { title: tab.title }),
              onclick: (e: Event) => {
                e.stopPropagation();
                close(tab.id);
              },
            },
            '×',
          ),
        ),
      ),
    );
    const page = tabs.find((tab) => tab.id === active);
    openOut.classList.toggle('hidden', !page);
    if (page) openOut.href = page.url;
  };
  const show = (id: string) => {
    active = id;
    const onMain = id === 'main';
    opts.host.classList.toggle('hidden', !onMain);
    pages.classList.toggle('hidden', onMain);
    opts.keypad?.classList.toggle('hidden', !onMain);
    for (const [tid, frame] of frames) frame.classList.toggle('hidden', tid !== id);
    render();
    if (onMain) opts.focusTerm();
  };
  const close = (id: string) => {
    const i = tabs.findIndex((tab) => tab.id === id);
    if (i < 0) return;
    tabs.splice(i, 1);
    frames.get(id)?.remove();
    frames.delete(id);
    if (active === id) show('main');
    else render();
  };
  const frameFor = (tab: WebTab) => {
    const frame = h('iframe.term-webframe.hidden', { src: tab.url, title: tab.title, loading: 'lazy', referrerpolicy: 'no-referrer', sandbox: SANDBOX }) as HTMLIFrameElement;
    frames.set(tab.id, frame);
    pages.append(frame);
  };
  for (const tab of tabs) frameFor(tab);
  render();

  addBtn.addEventListener('click', () => {
    form.classList.remove('hidden');
    tabName.focus();
  });
  const closeForm = () => {
    form.classList.add('hidden');
    tabName.value = '';
    tabUrl.value = '';
  };
  cancelBtn.addEventListener('click', closeForm);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(tabUrl.value.trim());
    } catch {
      toast(t('work.tabs.badUrl'), 'warn');
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return toast(t('work.tabs.onlyHttp'), 'warn');
    // The office itself would run in the frame signed in as you, with nothing between it and this page.
    if (parsed.origin === location.origin) return toast(t('work.tabs.noOffice'), 'warn');
    const tab: WebTab = { id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: tabName.value.trim() || parsed.hostname.replace(/^www\./, ''), url: parsed.toString() };
    tabs.push(tab);
    frameFor(tab);
    closeForm();
    show(tab.id);
  });
  return { bar, pages };
}
