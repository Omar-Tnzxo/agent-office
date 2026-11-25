/**
 * Markdown for what a watched visitor wrote. A transcript holds whatever a session read (a web page,
 * a file, a tool's output), so a prompt injection can put anything in its replies: nothing in one may
 * load from the network on its own. Pictures come out as their address in text, and anything else
 * that fetches (frames, media, styles, forms) is dropped. Links stay links, opened in a tab of their
 * own only when clicked; #123 and the like are left as text. The app's own markdown() (issues, PRs)
 * is a different renderer and stays as it is.
 */
import '../../ui/markdown.css';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { t } from '../../i18n';
import { h } from '../../ui/dom';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    // A picture is never fetched: its alt text and address, as text.
    image({ href, text }) {
      return `<span class="vw-img">[${escape(t('watch.image'))}${text ? `: ${escape(text)}` : ''}${href ? ` ${escape(href)}` : ''}]</span>`;
    },
    // Raw HTML in the text is shown as text, not put on the page.
    html({ text }) {
      return escape(text);
    },
  },
});

const purify = DOMPurify(window);
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
    node.setAttribute('referrerpolicy', 'no-referrer');
  }
});

/** Everything that can fetch from the network by being on the page, or post to it. */
const FORBID_TAGS = ['img', 'picture', 'source', 'video', 'audio', 'track', 'iframe', 'frame', 'object', 'embed', 'link', 'meta', 'base', 'style', 'svg', 'math', 'form', 'input', 'button', 'select', 'textarea'];
const FORBID_ATTR = ['style', 'src', 'srcset', 'poster', 'background', 'action', 'formaction', 'ping', 'xlink:href'];

/** The sanitized HTML of `src`, as a string (for the tests too). */
export function transcriptHtml(src: string): string {
  return purify.sanitize(md.parse(src, { async: false }) as string, { FORBID_TAGS, FORBID_ATTR });
}

/** Renders a visitor's reply into a `.md` block. */
export function transcriptMarkdown(src: string): HTMLElement {
  const el = h('div.md');
  el.append(purify.sanitize(md.parse(src, { async: false }) as string, { FORBID_TAGS, FORBID_ATTR, RETURN_DOM_FRAGMENT: true }));
  return el;
}
