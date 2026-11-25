import { ROOF } from '../../shared/rooftop';
import { store } from '../state';
import type { Voice } from '../voice';
import { $, h } from './dom';
import { whereabouts } from './whereabouts';
import { onLang, t } from '../i18n';

/** What the people list last showed, so it's only drawn again when something in it changed. */
let peopleKey = '';

/** What it was last drawn with, so a switch of language can draw it again. */
let last: Parameters<typeof renderPeople> | null = null;
onLang(() => last && renderPeople(last[0], last[1], last[2], true));

/** The people list in the sidebar. Click yourself to change your character, or anyone else to walk over to them. */
export function renderPeople(voice: Voice, onEditProfile: () => void, onWalkTo: (id: string) => void, force = true) {
  last = [voice, onEditProfile, onWalkTo, force];
  const peers = [...store.peers.values()].sort((a, b) => (a.id === store.you ? -1 : b.id === store.you ? 1 : a.name.localeCompare(b.name)));
  // What each of them is up to changes as they walk about (onto the balcony, up the stairs).
  const doing = peers.map((p) => (p.id === store.you ? undefined : whereabouts(p, store.carOf(p.id))));
  const key = peers.map((p, i) => `${p.id}|${doing[i] ?? ''}`).join('\n');
  if (!force && key === peopleKey) return;
  peopleKey = key;
  const ul = $('people');
  ul.replaceChildren();
  peers.forEach((p, i) => {
    const you = p.id === store.you;
    const mic = !p.voice ? '' : p.muted ? '🔇' : '🎙️';
    const sub = doing[i];
    const li = h(
      'li',
      { 'data-peer': p.id, class: p.lite && !you ? undefined : 'walk', title: you ? t('panels.ppl.change') : p.lite ? t('panels.ppl.lite', { name: p.name }) : `${t(store.onMyFloor(p) ? 'panels.ppl.walk' : 'panels.ppl.elevator', { name: p.name })}${sub ? ` (${sub})` : ''}` },
      h('span.dot', { style: `background:${p.color}` }),
      h('span.name', {}, p.name, sub ? h('span.sub', {}, sub) : null),
      p.account ? h('span.acct', { title: t(you ? 'panels.ppl.acct.you' : 'panels.ppl.acct.them') }, '✓') : null,
      you ? h('span.you', {}, t('panels.ppl.you')) : null,
      // Somewhere else in the building: which floor.
      !you && !store.onMyFloor(p)
        ? p.floor === ROOF
          ? h('span.where', { title: t('panels.ppl.roof') }, `🍸 ${t('panels.elev.roof')}`)
          : h('span.where', { title: t('panels.ppl.otherFloor') }, `🛗 ${store.floors.find((f) => f.id === p.floor)?.name ?? t('panels.ppl.lobby')}`)
        : null,
      p.sharing ? h('span', { title: t('panels.ppl.sharing') }, '🖥️') : null,
      h('span.mic', {}, mic),
    );
    li.addEventListener('click', () => (you ? onEditProfile() : onWalkTo(p.id)));
    ul.append(li);
  });
  $('people-count').textContent = String(peers.length);
  void voice;
}

export function updateSpeaking(voice: Voice) {
  for (const li of document.querySelectorAll<HTMLElement>('#people li[data-peer]')) {
    const lvl = voice.levelOf(li.dataset.peer!);
    li.classList.toggle('speaking', lvl > 0.04);
  }
}
