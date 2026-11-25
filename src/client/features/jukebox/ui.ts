import './ui.css';
import { JUKEBOX_TUNES, STREAM, checkStreamUrl, trackTitle, tuneById } from '../../../shared/jukebox';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';
import { t } from '../../i18n';
import { serverText } from '../../i18n/server';

/** The jukebox: what's on, the tunes to pick from, skip and stop, and a box for a stream. */
export function openJukebox(net: Net, openVolume: () => void) {
  const close = h('button.btn.close', { 'aria-label': t('common.close') }, '✕');
  const now = h('div.jb-now');
  const list = h('ul.svc-list');
  const url = h('input', { type: 'text', placeholder: t('toys.juke.urlPh'), 'aria-label': t('toys.juke.urlLabel'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const playUrl = h('button.btn.primary', { type: 'button' }, `📻 ${t('toys.play')}`);
  const volume = h('button.btn', { type: 'button' }, t('toys.juke.volume'));
  const el = h(
    'div.modal.jukebox',
    { role: 'dialog', 'aria-label': t('toys.juke.name') },
    h('header', {}, h('h2', {}, t('toys.juke.title')), close),
    h(
      'div.body',
      {},
      now,
      h('label', { style: 'margin-top:16px' }, t('toys.juke.tune')),
      list,
      h('label', { style: 'margin-top:16px' }, t('toys.juke.stream')),
      h('div.webhook', {}, url, playUrl),
      h('p.setting-note', {}, t('toys.juke.streamNote')),
    ),
    h('footer', {}, h('span.grow', {}, t('toys.juke.foot')), volume),
  );

  const button = (label: string, title: string, send: () => void, primary = false) => h(primary ? 'button.btn.primary' : 'button.btn', { type: 'button', title, onclick: send }, label);

  const render = () => {
    const j = store.jukebox;
    const stream = j.track === STREAM;
    now.replaceChildren(
      h('span.jb-disc', { class: j.on ? 'spin' : '' }, stream ? '📻' : '💿'),
      h(
        'div.svc-main',
        {},
        h('div.svc-title', {}, j.on ? trackTitle(j) : t('toys.juke.isOff')),
        h('div.svc-meta', {}, j.on ? [stream ? t('toys.juke.aStream') : tuneById(j.track)?.mood, j.by && t('toys.juke.putOnBy', { name: j.by })].filter(Boolean).join(' · ') : j.by ? t('toys.juke.turnedOff', { name: j.by }) : t('toys.juke.pick')),
      ),
      j.on ? button(t('toys.juke.skip'), t('toys.juke.skipTitle'), () => net.send({ t: 'jukebox.skip' })) : button(`▶️ ${t('toys.play')}`, t('toys.juke.backOn', { title: trackTitle(j) }), () => net.send({ t: 'jukebox.play' }), true),
      j.on ? button(t('toys.juke.stop'), t('toys.juke.stopTitle'), () => net.send({ t: 'jukebox.stop' })) : '',
    );
    list.replaceChildren(
      ...JUKEBOX_TUNES.map((tune) => {
        const playing = j.on && j.track === tune.id;
        const li = h(
          'li',
          { class: playing ? 'on' : '', tabindex: 0, role: 'button', 'aria-pressed': String(playing), title: playing ? t('toys.juke.playingNow') : t('toys.juke.putOnTitle', { title: tune.title }) },
          h('span.jb-icon', {}, playing ? '🔊' : '🎵'),
          h('div.svc-main', {}, h('div.svc-title', {}, tune.title), h('div.svc-meta', {}, tune.mood)),
        );
        const pick = () => {
          if (!playing) net.send({ t: 'jukebox.play', track: tune.id });
        };
        li.addEventListener('click', pick);
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
        return li;
      }),
    );
  };

  const play = () => {
    const u = checkStreamUrl(url.value);
    if ('error' in u) {
      toast(serverText(u.error), 'warn');
      return url.focus();
    }
    net.send({ t: 'jukebox.play', url: u.url });
    url.value = '';
  };
  playUrl.addEventListener('click', play);
  url.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') play();
  });

  const modal = openModal(el, { doing: '🎵 at the jukebox', onClose: store.on('jukebox', render) });
  close.addEventListener('click', () => modal.close());
  volume.addEventListener('click', () => {
    modal.close();
    openVolume();
  });
  render();
}
