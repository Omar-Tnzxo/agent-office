// The review window's Markdown as HTML that loads nothing from anywhere: a picture is its name and
// where it is, written out, raw HTML in the file (a <video>, an <img srcset>, a <picture>) is shown as
// the text it is, and a task's box is a plain mark. It's sanitized after this as well (see ui.ts).
// No DOM here, so tests/handoffs.test.ts runs it as it is.
import { Marked } from 'marked';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new Marked({
  gfm: true,
  renderer: {
    image: ({ href, text }) => `<code class="rv-pic" title="${escape(href)}">🖼️ ${escape(text || href)} (${escape(href)})</code>`,
    html: ({ text }) => escape(text),
    checkbox: ({ checked }) => (checked ? '☑ ' : '☐ '),
  },
});

/** A file's Markdown as HTML with nothing in it that loads anything. */
export function reviewHtml(src: string): string {
  return md.parse(src, { async: false }) as string;
}
