import type { PlanWindow } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { panelHide } from './menu';
import { onLang, t, time } from '../i18n';

/** Numbers older than this say when they were read. */
const STALE_MS = 10 * 60_000;

/** "in 12m", "in 2h 5m", or "Tue 5:00 AM" once it is more than a day out. */
export function fmtReset(at: number, now = Date.now()): string {
  const mins = Math.ceil((at - now) / 60_000);
  if (mins <= 0) return t('panels.lim.now');
  if (mins < 60) return t('panels.lim.inM', { m: mins });
  if (mins < 24 * 60) return t('panels.lim.inHM', { h: Math.floor(mins / 60), m: mins % 60 });
  return time(at, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

const level = (pct: number) => (pct >= 90 ? 'over' : pct >= 75 ? 'near' : '');

/** The server names the windows in English ("5h session", "Week", "Opus week"): said here in the page's language. */
function windowName(label: string): string {
  if (label === '5h session') return t('panels.lim.session');
  if (label === 'Week') return t('panels.lim.week');
  const model = /^(.+) week$/.exec(label);
  return model ? t('panels.lim.modelWeek', { model: model[1] }) : label;
}

function windowRow(w: PlanWindow, now: number): HTMLElement[] {
  const pct = Math.round(w.pct);
  const when = w.resetsAt ? time(w.resetsAt, { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : '';
  const name = windowName(w.label);
  const scope = w.label === 'Week' ? t('panels.lim.allModels') : '';
  const title = `${t('panels.lim.used', { name: `${name}${scope}`, pct })}${when ? `\n${t('panels.lim.startsOver', { when })}` : ''}`;
  return [
    h(
      'div.row',
      { title },
      h('span.what', {}, name),
      h('b', { class: level(w.pct) }, `${pct}%`),
      w.resetsAt ? h('span.reset', {}, t('panels.lim.resets', { when: fmtReset(w.resetsAt, now) })) : null,
    ),
    h('div.meter', { class: level(w.pct), title, role: 'progressbar', 'aria-label': name, 'aria-valuenow': pct }, h('div.fill', { style: `width:${w.pct}%` })),
  ];
}

let drawn = false;
// Always on screen: a switch of language draws it again.
onLang(() => drawn && renderLimits());

/** The Claude plan's 5-hour session and weekly limits, under the workers. Click to read them again. */
export function renderLimits() {
  const s = store.limits;
  const el = $('limits');
  drawn = true;
  el.classList.toggle('hidden', !s.windows.length);
  if (!s.windows.length) return;
  const now = Date.now();
  const plan = s.plan ? s.plan.charAt(0).toUpperCase() + s.plan.slice(1) : '';
  el.replaceChildren(h('h3', {}, t('panels.lim.title'), plan ? h('span.plan', {}, plan) : null, panelHide('limits')), ...s.windows.flatMap((w) => windowRow(w, now)));
  if (now - s.at > STALE_MS) el.append(h('div.row.muted', {}, t('panels.lim.asOf', { when: time(s.at) })));
}
