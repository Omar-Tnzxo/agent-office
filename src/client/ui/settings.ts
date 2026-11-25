import './settings.css';
import type { Net } from '../net';
import type { OfficeSound } from '../sound';
import { store, type NeedsYouSound, type Settings, type ViewMode } from '../state';
import { askNotifyPermission, notifyPermission, type DesktopNotifier } from '../notify';
import type { ThemePick, WebhookKind } from '../../shared/protocol';
import { THEME_PICKS } from '../../shared/theme';
import { mapChoices } from '../../shared/maps';
import { dogSetting } from './settings-dog';
import { h, openModal, timeAgo } from './dom';
import { agentFields, choiceLabel, officeChoice } from './provider';
import { openPromptEditor, rewrittenPrompts } from './prompts';
import { outsideSetting } from './settings-sky';
import { choiceRow } from './settings-rows';
import { lang, LANG_NAME, LANGS, ltrText, onLang, setLang, t, tn, type TextKey } from '../i18n';

const VIEWS: [ViewMode, TextKey, TextKey][] = [
  ['first', 'settings.view.first', 'settings.view.first.note'],
  ['third', 'settings.view.third', 'settings.view.third.note'],
];

const THEME_LABEL: Record<ThemePick, TextKey> = { auto: 'settings.theme.auto', halloween: 'settings.theme.halloween', christmas: 'settings.theme.christmas', off: 'common.off' };

const WEBHOOK_NAME: Record<WebhookKind, () => string> = { slack: () => 'Slack', discord: () => 'Discord', other: () => t('settings.hook.other') };

/** The categories down the side of ⚙️ Settings. */
export type SettingsPane = 'you' | 'sound' | 'notify' | 'building' | 'workers';

const PANES: { id: SettingsPane; icon: string; label: TextKey; blurb: TextKey }[] = [
  { id: 'you', icon: '🧍', label: 'settings.pane.you', blurb: 'settings.pane.you.blurb' },
  { id: 'sound', icon: '🔊', label: 'settings.pane.sound', blurb: 'settings.pane.sound.blurb' },
  { id: 'notify', icon: '🔔', label: 'settings.pane.notify', blurb: 'settings.pane.notify.blurb' },
  { id: 'building', icon: '🏢', label: 'settings.pane.building', blurb: 'settings.pane.building.blurb' },
  { id: 'workers', icon: '🤖', label: 'settings.pane.workers', blurb: 'settings.pane.workers.blurb' },
];

/** Who a setting is for, shown by its name: some are yours alone, some the whole office's. */
type Scope = 'you' | 'floor' | 'office';
const SCOPE: Record<Scope, [label: TextKey, title: TextKey]> = {
  you: ['settings.scope.you', 'settings.scope.you.title'],
  floor: ['settings.scope.floor', 'settings.scope.floor.title'],
  office: ['settings.scope.office', 'settings.scope.office.title'],
};

/** One setting: its name and who it's for, then whatever sets it. */
const setting = (title: TextKey, scope: Scope | null, ...body: Node[]) =>
  h('div.setting', {}, h('div.setting-head', {}, h('h4', {}, t(title)), scope && h('span.scope', { class: scope, title: t(SCOPE[scope][1]) }, t(SCOPE[scope][0]))), ...body);

/** ", set by Ada 5m ago" after a sentence, or nothing when nobody set it. */
const setBy = (by: string | undefined, at: string | number | undefined, picked = false) =>
  by ? t(picked ? (at ? 'settings.pickedByAt' : 'settings.pickedBy') : at ? 'settings.setByAt' : 'settings.setBy', { who: by, when: at ? timeAgo(at) : '' }) : '';

/** Where ⚙️ Settings was last, so it opens there again. */
let lastPane: SettingsPane = 'you';

/** `outside` describes the sky over the office (see describeSky), once the server has said. `first` opens on that category instead of the last one. */
export function openSettings(net: Net, settings: Settings, onChange: (s: Settings) => void, onCharacter: () => void, sound: Pick<OfficeSound, 'ding' | 'needsYou'>, notifier: DesktopNotifier, onSignOut: () => void, outside?: { now: string; live: boolean }, first?: SettingsPane) {
  const seg = h('div.seg', { role: 'radiogroup', 'aria-label': t('settings.camera') });
  const note = h('p.setting-note');
  const paint = () => {
    seg.replaceChildren(
      ...VIEWS.map(([view, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(settings.view === view),
            class: settings.view === view ? 'on' : '',
            onclick: () => {
              if (settings.view === view) return;
              settings = { ...settings, view };
              onChange(settings);
              paint();
            },
          },
          t(label),
        ),
      ),
    );
    note.textContent = t(VIEWS.find(([v]) => v === settings.view)![2]);
  };
  paint();

  // The language, for you alone, in this browser. Each is named in itself, so you can find yours.
  const langRow = choiceRow(t('settings.language'), LANGS.map((l) => [l, LANG_NAME[l]] as const), lang, setLang);
  langRow.querySelectorAll('button').forEach((b, i) => (b.lang = LANGS[i]));

  /** A volume slider with its mute button. Dragging it turns the sound back on; letting go plays `preview`. */
  const volumeRow = (label: string, level: 'volume' | 'music', muted: 'muted' | 'musicMuted', preview?: () => void) => {
    const slider = h('input', { type: 'range', min: 0, max: 100, step: 1, 'aria-label': label });
    const pct = h('span.vol-pct');
    const mute = h('button.btn', { type: 'button' });
    const row = h('div.volume', {}, mute, slider, pct);
    const paint = () => {
      const v = Math.round(settings[level] * 100);
      slider.value = String(v);
      slider.style.setProperty('--fill', `${v}%`);
      pct.textContent = settings[muted] ? t('settings.muted') : `${v}%`;
      mute.textContent = t(settings[muted] ? 'settings.unmute' : 'settings.mute');
      mute.setAttribute('aria-pressed', String(settings[muted]));
      mute.classList.toggle('danger', settings[muted]);
      row.classList.toggle('muted', settings[muted]);
    };
    paint();
    slider.addEventListener('input', () => {
      settings = { ...settings, [level]: Number(slider.value) / 100, [muted]: false };
      onChange(settings);
      paint();
    });
    if (preview) slider.addEventListener('change', preview);
    mute.addEventListener('click', () => {
      settings = { ...settings, [muted]: !settings[muted] };
      onChange(settings);
      paint();
      if (!settings[muted]) preview?.();
    });
    return row;
  };
  const soundRow = volumeRow(t('settings.sounds.volume'), 'volume', 'muted', () => sound.ding('done'));

  /** Changes some of your own settings, and has the office take them up. */
  const change = (some: Partial<Settings>) => {
    settings = { ...settings, ...some };
    onChange(settings);
  };
  // Voice chat: an open mic, or muted until you hold V.
  const talkRow = choiceRow(t('settings.voice'), [[false, t('settings.voice.open')], [true, t('settings.voice.ptt')]], () => settings.pushToTalk, (pushToTalk) => change({ pushToTalk }));
  const musicRow = volumeRow(t('settings.jukebox.volume'), 'music', 'musicMuted');

  // The swish of the book's pages at the bookshelf, on or off.
  const pagesRow = choiceRow(t('settings.pages'), [[true, t('settings.pages.on')], [false, t('common.off')]], () => settings.pageTurns, (pageTurns) => change({ pageTurns }));
  // The alarm when a worker stops to ask you something; picking one plays it.
  const alarmRow = choiceRow<NeedsYouSound>(t('settings.needsYou'), [['once', t('settings.needsYou.once')], ['remind', t('settings.needsYou.remind')], ['off', t('settings.needsYou.off')]], () => settings.needsYouSound, (needsYouSound) => {
    change({ needsYouSound });
    if (needsYouSound !== 'off') sound.needsYou();
  });

  // The building's holiday theme, for everyone.
  const themeRow = h('div.seg', { role: 'radiogroup', 'aria-label': t('settings.theme') });
  const themeNote = h('p.setting-note');
  const paintTheme = () => {
    const { pick, active, by, at } = store.theme;
    themeRow.replaceChildren(
      ...THEME_PICKS.map((p) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(pick === p),
            class: pick === p ? 'on' : '',
            onclick: () => {
              if (store.theme.pick !== p) net.send({ t: 'theme.set', pick: p });
            },
          },
          t(THEME_LABEL[p]),
        ),
      ),
    );
    const now = t(active === 'halloween' ? 'settings.theme.halloween.now' : active === 'christmas' ? 'settings.theme.christmas.now' : 'settings.theme.none');
    const how = pick === 'auto' ? t('settings.theme.how') : '';
    themeNote.textContent = t('settings.sameForAll', { now: `${now}${how}`, by: setBy(by, at) });
  };
  paintTheme();

  // The building's map, for everyone: the office, the castle, the space station, or one of your own. Opening Settings
  // has the office read its folder of maps again, so one you just added or fixed shows up.
  net.send({ t: 'map.set' });
  const mapRow = h('div.seg', { role: 'radiogroup', 'aria-label': t('settings.map') });
  const mapNote = h('p.setting-note');
  const mapBad = h('p.setting-note.bad', { style: 'white-space: pre-line' });
  const paintMap = () => {
    const { pick, by, at, custom } = store.map;
    const choices = mapChoices(custom);
    mapRow.replaceChildren(
      ...choices.map((m) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(pick === m.id),
            class: pick === m.id ? 'on' : '',
            disabled: !!m.error,
            title: m.error ? t('settings.map.wontLoad', { id: m.id, error: m.error }) : m.description,
            onclick: () => {
              if (!m.error && store.map.pick !== m.id) net.send({ t: 'map.set', map: m.id });
            },
          },
          `${m.icon} ${m.name}`,
        ),
      ),
    );
    const now = choices.find((m) => m.id === pick) ?? choices[0];
    mapNote.textContent = t('settings.map.note', { about: now.description, by: setBy(by, at, true) });
    const broken = choices.filter((m) => m.error);
    mapBad.textContent = broken.map((m) => `⚠️ ${t('settings.map.wontLoad', { id: m.id, error: m.error ?? '' })}`).join('\n');
    mapBad.hidden = !broken.length;
  };
  paintMap();

  // Desktop notifications: this browser's permission, then your own on/off.
  const notifyRow = h('div.seg');
  const notifyNote = h('p.setting-note');
  const paintNotify = () => {
    const perm = notifyPermission();
    const on = perm === 'granted' && settings.notify;
    notifyRow.replaceChildren();
    if (perm === 'default') {
      notifyRow.append(
        h(
          'button.btn.primary',
          {
            type: 'button',
            onclick: async () => {
              if ((await askNotifyPermission()) === 'granted') {
                settings = { ...settings, notify: true };
                onChange(settings);
                notifier.sample();
              }
              paintNotify();
            },
          },
          t('settings.desktop.turnOn'),
        ),
      );
    } else if (perm === 'granted') {
      for (const [value, label] of [
        [true, t('settings.desktop.on')],
        [false, t('settings.desktop.off')],
      ] as const) {
        notifyRow.append(
          h(
            'button.btn',
            {
              type: 'button',
              role: 'radio',
              'aria-checked': String(on === value),
              class: on === value ? 'on' : '',
              onclick: () => {
                settings = { ...settings, notify: value };
                onChange(settings);
                paintNotify();
              },
            },
            label,
          ),
        );
      }
      if (on) notifyRow.append(h('button.btn', { type: 'button', onclick: () => notifier.sample() }, t('settings.desktop.sample')));
    }
    notifyNote.textContent = t(perm === 'unsupported' ? 'settings.desktop.unsupported' : perm === 'denied' ? 'settings.desktop.denied' : 'settings.desktop.note');
  };
  paintNotify();

  // The office's Slack / Discord webhook, shared by everyone.
  const hookStatus = h('p.setting-note');
  const hookInput = h('input.ltr', { type: 'text', placeholder: 'https://hooks.slack.com/services/…', 'aria-label': t('settings.hook.aria'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const hookSave = h('button.btn.primary', { type: 'button' }, t('common.save'));
  const hookTest = h('button.btn', { type: 'button' }, t('settings.hook.test'));
  const hookRemove = h('button.btn.danger', { type: 'button' }, t('common.remove'));
  const hookActions = h('div.seg', { style: 'margin-top:8px' }, hookTest, hookRemove);
  const paintHook = () => {
    const { webhook, error, lastSentAt } = store.notify;
    hookActions.classList.toggle('hidden', !webhook);
    hookSave.textContent = t(webhook ? 'settings.hook.replace' : 'common.save');
    hookStatus.classList.toggle('bad', !!error);
    hookStatus.textContent = !webhook
      ? t('settings.hook.none')
      : error
        ? t('settings.hook.failed', { kind: WEBHOOK_NAME[webhook.kind](), hint: ltrText(webhook.hint), error })
        : t('settings.hook.ok', { kind: WEBHOOK_NAME[webhook.kind](), hint: ltrText(webhook.hint), who: webhook.by, when: timeAgo(webhook.at), last: lastSentAt ? t('settings.hook.last', { when: timeAgo(lastSentAt) }) : '' });
  };
  paintHook();
  const saveHook = () => {
    const url = hookInput.value.trim();
    if (!url) return hookInput.focus();
    net.send({ t: 'notify.webhook', url });
    hookInput.value = '';
  };
  hookSave.addEventListener('click', saveHook);
  hookInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveHook();
  });
  hookTest.addEventListener('click', () => net.send({ t: 'notify.test' }));
  hookRemove.addEventListener('click', () => net.send({ t: 'notify.webhook', url: '' }));

  // The worker everyone starts on, unless whoever starts one picks another. Admins pick it.
  const agent = agentFields(store.project, 'office-agent', officeChoice(store.project));
  let agentTouched = false;
  agent.element.addEventListener('change', () => (agentTouched = true));
  agent.element.addEventListener('input', () => (agentTouched = true));
  const agentSave = h('button.btn.primary', { type: 'button' }, t('common.save'));
  const agentBack = h('button.btn', { type: 'button' });
  const agentActions = h('div.seg', { style: 'margin-top:8px' }, agentSave, agentBack);
  const agentNow = h('p.outside-now');
  const agentNote = h('p.setting-note');
  const paintAgent = () => {
    const admin = store.me.admin;
    const picked = store.prompts.agent;
    const now = officeChoice(store.project);
    agent.element.classList.toggle('hidden', !admin);
    agentActions.classList.toggle('hidden', !admin);
    agentNow.classList.toggle('hidden', admin);
    agentNow.textContent = choiceLabel(now);
    agentBack.classList.toggle('hidden', !picked);
    const cmd = store.project?.agentCmd.split(' ')[0].split(/[\\/]/).pop();
    agentBack.textContent = t('settings.agent.back', { cmd: cmd ? ltrText(cmd) : t('settings.agent.flag') });
    if (!agentTouched) agent.set(now);
    agentNote.textContent = t('settings.agent.note') + (picked ? t('settings.setBySentence', { who: picked.by, when: timeAgo(picked.at) }) : t('settings.agent.started')) + (admin ? '' : t('settings.adminsChange'));
  };
  paintAgent();
  agentSave.addEventListener('click', () => {
    if (!agent.valid()) return;
    agentTouched = false;
    net.send({ t: 'prompts.agent', choice: agent.choice() });
  });
  agentBack.addEventListener('click', () => {
    agentTouched = false;
    net.send({ t: 'prompts.agent', choice: null });
  });

  // The prompts the office writes for workers by itself, for the whole office. Admins rewrite them.
  const promptsOpen = h('button.btn', { type: 'button', onclick: () => openPromptEditor(net) });
  const promptsNote = h('p.setting-note');
  const paintPrompts = () => {
    const n = rewrittenPrompts();
    promptsOpen.textContent = t(store.me.admin ? 'settings.prompts.edit' : 'settings.prompts.read');
    promptsNote.textContent = t('settings.prompts.note') + (n ? tn('settings.prompts.rewritten', n) : t('settings.prompts.original')) + (store.me.admin ? '' : t('settings.prompts.admins'));
  };
  paintPrompts();

  // The most workers the office runs at once, across every floor. Admins set it.
  const limitInput = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': t('settings.limit.aria'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const limitSave = h('button.btn.primary', { type: 'button' }, t('settings.limit.set'));
  const limitClear = h('button.btn', { type: 'button' });
  const limitRow = h('div.webhook', {}, limitInput, limitSave, limitClear);
  const limitNote = h('p.setting-note');
  const paintLimit = () => {
    const m = store.machine;
    const admin = store.me.admin;
    limitRow.classList.toggle('hidden', !admin);
    limitInput.placeholder = m.ceiling ? t('settings.limit.range', { max: m.ceiling }) : t('settings.limit.example');
    limitClear.textContent = m.ceiling ? t('settings.limit.back', { n: m.ceiling }) : t('settings.limit.none');
    limitClear.classList.toggle('hidden', !m.set);
    const now = m.limit === undefined ? tn('settings.limit.noneNote', m.workers) : tn('settings.limit.note', m.limit, { now: m.workers });
    const from = m.set ? t('settings.setBySentence', { who: m.set.by, when: timeAgo(m.set.at) }) : '';
    const cap = m.ceiling ? t('settings.limit.cap', { n: m.ceiling }) : '';
    limitNote.textContent = now + from + cap + (admin ? '' : t('settings.adminsChange'));
  };
  paintLimit();
  const saveLimit = () => {
    const n = Number(limitInput.value.trim());
    if (!limitInput.value.trim() || !Number.isInteger(n) || n < 1) return limitInput.focus();
    net.send({ t: 'machine.limit', limit: n });
    limitInput.value = '';
  };
  limitSave.addEventListener('click', saveLimit);
  limitInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveLimit();
  });
  limitClear.addEventListener('click', () => net.send({ t: 'machine.limit', limit: null }));

  // Whether a worker whose pull request merged goes home by itself, for everyone.
  const leaveRow = h('div.seg', { role: 'radiogroup', 'aria-label': t('settings.leave') });
  const leaveNote = h('p.setting-note');
  const paintLeave = () => {
    const { on, by, at } = store.leaveOnMerge;
    leaveRow.replaceChildren(
      ...([
        [true, t('settings.leave.go')],
        [false, t('settings.leave.stay')],
      ] as const).map(([value, label]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(on === value),
            class: on === value ? 'on' : '',
            onclick: () => {
              if (store.leaveOnMerge.on !== value) net.send({ t: 'leaveOnMerge.set', on: value });
            },
          },
          label,
        ),
      ),
    );
    leaveNote.textContent = t('settings.sameForAll', { now: t(on ? 'settings.leave.goNote' : 'settings.leave.stayNote'), by: setBy(by, at) });
  };
  paintLeave();

  // Where the elevator clones new projects on the office's machine. Admins move it.
  const dirInput = h('input.ltr', { type: 'text', placeholder: '~/Workspace', 'aria-label': t('settings.dir'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const dirSave = h('button.btn.primary', { type: 'button' }, t('common.save'));
  const dirDefault = h('button.btn', { type: 'button' }, t('settings.dir.default'));
  const dirRow = h('div.webhook', {}, dirInput, dirSave);
  const dirActions = h('div.seg', { style: 'margin-top:8px' }, dirDefault);
  const dirNote = h('p.setting-note');
  const paintDir = () => {
    const { dir, custom, by, at } = store.projectsDir;
    const admin = store.me.admin;
    dirInput.value = dir;
    dirRow.classList.toggle('hidden', !admin);
    dirActions.classList.toggle('hidden', !admin || !custom);
    dirNote.textContent =
      t('settings.dir.note', { path: ltrText(`${dir}/<owner>/<repo>`) }) +
      (custom && by && at ? t('settings.setBySentence', { who: by, when: timeAgo(at) }) : '') +
      t(admin ? 'settings.dir.admin' : 'settings.dir.notAdmin');
  };
  paintDir();
  const saveDir = () => {
    const dir = dirInput.value.trim();
    if (!dir) return dirInput.focus();
    if (dir !== store.projectsDir.dir) net.send({ t: 'floor.projectsDir', dir });
  };
  dirSave.addEventListener('click', saveDir);
  dirInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveDir();
  });
  dirDefault.addEventListener('click', () => net.send({ t: 'floor.projectsDir', dir: '' }));

  // The dog on this floor: its name, breed and coat, for everyone here (see settings-dog.ts).
  const { section: dogSection, paint: paintDog } = dogSetting(net, (body) => setting('settings.dog', 'floor', ...body));

  // What the sky's doing, and which clock it keeps (see settings-sky.ts).
  const sky = outside && outsideSetting(net, outside, (body) => setting('settings.outside', 'office', ...body));
  const account = store.me.account;
  const signOut = h('button.btn', { type: 'button' }, t('settings.signOut'));
  signOut.addEventListener('click', onSignOut);
  const character = h('button.btn', { type: 'button' }, t(account ? 'settings.changeLook' : 'settings.changeLookName'));
  const role = account && (account.role === 'admin' ? t('settings.role.admin') : account.role === 'member' ? t('settings.role.member') : account.role);
  const panes: Record<SettingsPane, Node[]> = {
    you: [
      setting('settings.character', null, character),
      setting('settings.language', 'you', langRow, h('p.setting-note', {}, t('settings.language.note'))),
      setting('settings.camera', 'you', seg, note),
      setting('settings.signedIn', null, h('div.volume', {}, signOut), h('p.setting-note', {}, account ? t('settings.signedInAs', { name: account.name, role: role ?? '' }) : t('settings.signedInShared'))),
    ],
    sound: [
      setting('settings.sounds', 'you', soundRow, h('p.setting-note', {}, t('settings.sounds.note'))),
      setting('settings.needsYou', 'you', alarmRow, h('p.setting-note', {}, t('settings.needsYou.note'))),
      setting('settings.pages', 'you', pagesRow, h('p.setting-note', {}, t('settings.pages.note'))),
      setting('settings.jukebox', 'you', musicRow, h('p.setting-note', {}, t('settings.jukebox.note'))),
      setting('settings.voice', 'you', talkRow, h('p.setting-note', {}, t('settings.voice.note'))),
    ],
    notify: [
      setting('settings.desktop', 'you', notifyRow, notifyNote),
      setting('settings.team', 'office', h('div.webhook', {}, hookInput, hookSave), hookActions, hookStatus),
    ],
    building: [
      setting('settings.map', 'office', mapRow, mapNote, mapBad),
      setting('settings.theme', 'office', themeRow, themeNote),
      ...(sky ? [sky.section] : []),
      dogSection,
      setting('settings.dir', 'office', dirRow, dirActions, dirNote),
    ],
    workers: [
      setting('settings.agent', 'office', agentNow, agent.element, agentActions, agentNote),
      setting('settings.limit', 'office', limitRow, limitNote),
      setting('settings.leave', 'office', leaveRow, leaveNote),
      setting('settings.prompts', 'office', promptsOpen, promptsNote),
    ],
  };

  // The categories down the side, the one picked on the right.
  const nav = h('nav.settings-nav', { role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': t('settings.label') });
  const tabs = new Map<SettingsPane, HTMLButtonElement>();
  const bodies = new Map<SettingsPane, HTMLElement>();
  for (const p of PANES) {
    const tab = h('button.settings-tab', { type: 'button', role: 'tab', onclick: () => show(p.id) }, h('span.icon', { 'aria-hidden': 'true' }, p.icon), h('span', {}, t(p.label))) as HTMLButtonElement;
    tabs.set(p.id, tab);
    nav.append(tab);
    bodies.set(p.id, h('section.settings-pane', { role: 'tabpanel', 'aria-label': t(p.label) }, h('div.settings-head', {}, h('h3', {}, `${p.icon} ${t(p.label)}`), h('p', {}, t(p.blurb))), ...panes[p.id]));
  }
  const show = (id: SettingsPane) => {
    lastPane = id;
    for (const [t, tab] of tabs) {
      tab.classList.toggle('on', t === id);
      tab.setAttribute('aria-selected', String(t === id));
      tab.tabIndex = t === id ? 0 : -1;
    }
    for (const [t, body] of bodies) body.classList.toggle('hidden', t !== id);
    bodies.get(id)!.scrollTop = 0;
    // On a phone the categories are a row across the top that scrolls sideways.
    tabs.get(id)!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  nav.addEventListener('keydown', (e) => {
    // Right is the next one across a phone's row in English, the one before it in Arabic.
    const side = lang() === 'ar' ? -1 : 1;
    const step = { ArrowDown: 1, ArrowRight: side, ArrowUp: -1, ArrowLeft: -side }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = PANES.findIndex((p) => p.id === lastPane);
    const next = PANES[(i + step + PANES.length) % PANES.length].id;
    show(next);
    tabs.get(next)!.focus();
  });

  const close = h('button.btn.close', { 'aria-label': t('common.close') }, '✕');
  const el = h('div.modal.settings', { role: 'dialog', 'aria-label': t('settings.label') }, h('header', {}, h('h2', {}, t('settings.title')), close), h('div.settings-body', {}, nav, ...bodies.values()));
  const offNotify = store.on('notify', paintHook);
  const offDog = store.on('dog', paintDog);
  const offTheme = store.on('theme', paintTheme);
  const offMap = store.on('map', paintMap);
  const offLeave = store.on('leaveOnMerge', paintLeave);
  const offLimit = [store.on('machine', paintLimit), store.on('me', paintLimit)];
  const offDir = [store.on('projectsDir', paintDir), store.on('me', paintDir)];
  const offPrompts = [store.on('prompts', paintAgent), store.on('prompts', paintPrompts), store.on('me', paintAgent), store.on('me', paintPrompts)];
  // A switch of language opens Settings again in the new words, where it was, with the switch in focus.
  let relang = false;
  const offLang = onLang(() => {
    relang = true;
    modal.close();
  });
  const modal = openModal(el, {
    // In English: teammates see it under your name tag, each in their own language (see i18n/server.ts).
    doing: '⚙️ in settings',
    onClose: () => {
      offNotify();
      offDog();
      offTheme();
      sky?.off();
      offMap();
      offLeave();
      offLimit.forEach((off) => off());
      offDir.forEach((off) => off());
      offPrompts.forEach((off) => off());
      offLang();
      if (!relang) return;
      openSettings(net, settings, onChange, onCharacter, sound, notifier, onSignOut, outside, lastPane);
      document.querySelector<HTMLElement>('.settings [lang].on')?.focus();
    },
  });
  show(first ?? lastPane);
  close.addEventListener('click', () => modal.close());
  character.addEventListener('click', () => {
    modal.close();
    onCharacter();
  });
}
