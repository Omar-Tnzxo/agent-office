/**
 * The language on a page's own HTML: its lang and dir, and the words written in the .html file,
 * marked with the key to show (data-i18n for the text, data-i18n-title, data-i18n-aria and
 * data-i18n-placeholder for those attributes). They're filled in at load and again on a switch.
 */
import { applyDocument, lang, LANG_NAME, onLang, setLang, t, type Lang, type TextKey, type Vars } from '.';

export function translateDom(root: ParentNode = document) {
  const each = (attr: string, put: (el: HTMLElement, text: string) => void) =>
    root.querySelectorAll<HTMLElement>(`[${attr}]`).forEach((el) => put(el, t(el.getAttribute(attr) as TextKey)));
  each('data-i18n', (el, text) => (el.textContent = text));
  each('data-i18n-title', (el, text) => (el.title = text));
  each('data-i18n-aria', (el, text) => el.setAttribute('aria-label', text));
  each('data-i18n-placeholder', (el, text) => el.setAttribute('placeholder', text));
}

/** Puts the language on the page now and after every switch, with `title` as the tab's title if given. */
export function installPageLanguage(title?: TextKey) {
  const paint = () => {
    applyDocument();
    translateDom();
    if (title) document.title = t(title);
  };
  paint();
  onLang(paint);
}

/**
 * The small language switch on the pages before the office (sign in, an invite, a claim link), where
 * ⚙️ Settings isn't there yet: it names the other language, in that language, and switches to it.
 */
export function langSwitch(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lang-switch';
  const paint = () => {
    const other: Lang = lang() === 'ar' ? 'en' : 'ar';
    btn.textContent = LANG_NAME[other];
    btn.lang = other;
    btn.title = t('login.langSwitch');
  };
  btn.addEventListener('click', () => setLang(lang() === 'ar' ? 'en' : 'ar'));
  paint();
  onLang(paint);
  return btn;
}

/**
 * A phrase with elements in some of its {holes}, like a key to press in the middle of a sentence:
 * `rich('hud.menuFoot', { key: kbd })` is the phrase's text around `kbd`, in the language's order.
 */
export function rich(key: TextKey, nodes: Readonly<Record<string, Node>>, vars?: Vars): Node[] {
  const out: Node[] = [];
  let at = 0;
  const text = t(key, vars);
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    const node = nodes[m[1]];
    if (!node) continue;
    if (m.index > at) out.push(document.createTextNode(text.slice(at, m.index)));
    out.push(node);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
  return out;
}

/**
 * Text that reads left to right whatever the page does: a path, a branch, a command, a URL. In an
 * Arabic sentence it keeps its own order and doesn't drag the words around it.
 */
export function ltr(text: string): HTMLElement {
  const el = document.createElement('bdi');
  el.dir = 'ltr';
  el.textContent = text;
  return el;
}
