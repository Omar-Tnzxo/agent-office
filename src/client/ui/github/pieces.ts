import type { GhComment } from '../../../shared/protocol';
import { AVATAR_COLORS } from '../../state';
import { h, timeAgo } from '../dom';
import { t, type TextKey } from '../../i18n';
import { serverText } from '../../i18n/server';
import { markdown } from '../markdown';

// ---- Small pieces ---------------------------------------------------------------------------------

export function avatar(name: string) {
  let x = 0;
  for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return h('span.gh-avatar', { style: `background:${AVATAR_COLORS[Math.abs(x) % AVATAR_COLORS.length]}`, 'aria-hidden': 'true' }, (name[0] ?? '?').toUpperCase());
}

export function when(iso: string, url?: string) {
  const title = iso ? new Date(iso).toLocaleString() : '';
  return url ? h('a.when', { href: url, target: '_blank', rel: 'noopener noreferrer', title }, timeAgo(iso)) : h('span.when', { title }, timeAgo(iso));
}

/** A review's badge, its words read in the language now. */
const badge = (key: TextKey, cls: string): PropertyDescriptor => ({ get: (): [string, string] => [t(key), cls], enumerable: true });

export const REVIEW_BADGE: Record<string, [string, string]> = Object.defineProperties({} as Record<string, [string, string]>, {
  APPROVED: badge('github.review.approved', 'ok'),
  CHANGES_REQUESTED: badge('github.review.changes', 'bad'),
  COMMENTED: badge('github.review.commented', ''),
  DISMISSED: badge('github.review.dismissed', 'muted'),
});

export function commentCard(c: GhComment, itemUrl: string, verb: string, badge?: [string, string]) {
  return h(
    'article.gh-card',
    { class: badge?.[1] ? `is-${badge[1]}` : '' },
    h('header', {}, avatar(c.author), h('b', {}, c.author), h('span', {}, verb), when(c.createdAt, c.url), badge ? h('span.gh-badge', { class: badge[1] }, badge[0]) : null),
    c.body.trim() || !badge ? markdown(c.body, itemUrl) : null,
  );
}

/** Drops the nulls of optional pieces, for replaceChildren. */
export function nodes(...xs: (Node | string | null | undefined)[]): (Node | string)[] {
  return xs.filter((x): x is Node | string => x != null);
}

export function spinnerRow(text: string) {
  return h('div.gh-loading', {}, h('span.spinner'), text);
}

export function errorBox(text: string, retry?: () => void) {
  return h('div.gh-error', {}, t('github.loadError', { error: serverText(text) }), retry ? h('button.btn', { type: 'button', onclick: retry }, t('common.retry')) : null);
}

export function stateOf(it: { state: string; isDraft?: boolean }): [string, string] {
  if (it.state === 'MERGED') return [t('github.state.merged'), 'merged'];
  if (it.state === 'CLOSED') return [t('github.state.closed'), 'offline'];
  return it.isDraft ? [t('github.state.draft'), 'idle'] : [t('github.state.open'), 'working'];
}
