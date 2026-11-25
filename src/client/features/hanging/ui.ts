import './ui.css';
import { FRAMES, checkImageUrl, type Decoration } from '../../../shared/decor';
import { store } from '../../state';
import { holdPicture, loadPicture, type Picture } from './world';
import { h, openModal, timeAgo } from '../../ui/dom';
import { confirmDialog } from '../../ui/prompt';
import { t } from '../../i18n';
import { serverText } from '../../i18n/server';

export interface HangChoice {
  picture: Picture;
  title: string;
  frame: number;
}

const FRAME_KEY = 'agent-office.frame';
function lastFrame(): number {
  try {
    const n = Number(localStorage.getItem(FRAME_KEY));
    return Number.isInteger(n) && n >= 0 && n < FRAMES.length ? n : 0;
  } catch {
    return 0;
  }
}

/** Where an image link comes from, in the page's language. */
const tip = () => t('toys.hang.tip');
/** The frames' names (shared/decor.ts names them in English), in FRAMES' order. */
const FRAME_NAMES = ['toys.frame.wood', 'toys.frame.black', 'toys.frame.white', 'toys.frame.gold', 'toys.frame.coral', 'toys.frame.teal'] as const;

/** Pick an image, a title and a frame. Editing a picture (`initial`) fills them in. */
export function openHangDialog(opts: { initial?: Decoration; onDone(choice: HangChoice): void }) {
  const init = opts.initial;
  const urlIn = h('input', { type: 'text', dir: 'ltr', placeholder: 'https://…/picture.png', 'aria-label': t('toys.hang.link'), spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const titleIn = h('input', { type: 'text', maxlength: 80, placeholder: t('toys.hang.optional'), 'aria-label': t('toys.hang.titleLabel'), autocomplete: 'off' }) as HTMLInputElement;
  urlIn.value = init?.url ?? '';
  titleIn.value = init?.title ?? '';
  let frame = init?.frame ?? lastFrame();
  const frames = h('div.seg', { role: 'radiogroup', 'aria-label': t('toys.hang.frame') });
  const preview = h('div.hang-preview');
  const status = h('p.hang-status', {}, tip());
  const submit = h('button.btn.primary', { type: 'submit', disabled: true }, init ? t('common.save') : t('toys.hang.pickSpot')) as HTMLButtonElement;
  const cancel = h('button.btn', { type: 'button' }, t('common.cancel'));
  const close = h('button.btn.close', { type: 'button', 'aria-label': t('common.close') }, '✕');
  const form = h(
    'form.modal.hang',
    { role: 'dialog', 'aria-label': t(init ? 'toys.hang.edit' : 'toys.hang.title') },
    h('header', {}, h('h2', {}, `🖼️ ${t(init ? 'toys.hang.edit' : 'toys.hang.title')}`), close),
    h(
      'div.body',
      {},
      h('label', {}, t('toys.hang.link')),
      urlIn,
      h('label', { style: 'margin-top:12px' }, t('toys.hang.titleLabel')),
      titleIn,
      h('label', { style: 'margin-top:12px' }, t('toys.hang.frame')),
      frames,
      preview,
      status,
    ),
    h('footer', {}, h('span.grow', {}, init ? '' : t('toys.hang.then')), cancel, submit),
  ) as HTMLFormElement;

  let pic: Picture | null = null;
  let release = () => {};
  let seq = 0;
  let loading = false;
  /** Enter was pressed before the image loaded: go on as soon as it does. */
  let submitWhenLoaded = false;

  const paintFrames = () => {
    frames.replaceChildren(
      ...FRAMES.map((f, i) =>
        h(
          'button.btn',
          { type: 'button', role: 'radio', 'aria-checked': String(i === frame), class: i === frame ? 'on' : '', onclick: () => ((frame = i), paintFrames()) },
          h('span.dot', { style: `background:${f.color}` }),
          FRAME_NAMES[i] ? t(FRAME_NAMES[i]) : f.name,
        ),
      ),
    );
    preview.style.setProperty('--frame', FRAMES[frame].color);
  };
  paintFrames();

  const setStatus = (text: string, kind: '' | 'loading' | 'error' = '') => {
    status.className = `hang-status ${kind}`;
    status.replaceChildren(kind === 'loading' ? h('span.spinner') : '', text);
  };

  const load = async () => {
    const my = ++seq;
    loading = false;
    pic = null;
    submit.disabled = true;
    release();
    release = () => {};
    preview.replaceChildren();
    const raw = urlIn.value.trim();
    if (!raw) return setStatus(tip());
    const checked = checkImageUrl(raw);
    if ('error' in checked) return setStatus(serverText(checked.error), 'error');
    release = holdPicture(checked.url);
    setStatus(t('toys.hang.loading'), 'loading');
    loading = true;
    try {
      const p = await loadPicture(checked.url);
      if (my !== seq) return;
      loading = false;
      pic = p;
      preview.replaceChildren(h('img', { src: p.src, alt: t('toys.hang.preview') }));
      setStatus('');
      submit.disabled = false;
      if (submitWhenLoaded) finish();
    } catch (err) {
      if (my !== seq) return;
      loading = false;
      submitWhenLoaded = false;
      setStatus((err as Error).message, 'error');
    }
  };
  let timer = 0;
  urlIn.addEventListener('input', () => {
    submitWhenLoaded = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => void load(), 350);
  });
  // With the button disabled, Enter wouldn't submit the form at all.
  for (const input of [urlIn, titleIn]) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || pic) return;
      e.preventDefault();
      if (!urlIn.value.trim()) return;
      submitWhenLoaded = true;
      if (!loading) {
        clearTimeout(timer);
        void load();
      }
    });
  }

  const modal = openModal(form, {
    doing: '🖼️ hanging a picture',
    onClose: () => {
      seq++;
      clearTimeout(timer);
      release();
    },
  });
  close.addEventListener('click', () => modal.close());
  cancel.addEventListener('click', () => modal.close());
  const finish = () => {
    if (!pic) return;
    try {
      localStorage.setItem(FRAME_KEY, String(frame));
    } catch {
      // storage blocked
    }
    const choice = { picture: pic, title: titleIn.value.trim(), frame };
    modal.close();
    opts.onDone(choice);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    finish();
  });
  if (urlIn.value) void load();
  setTimeout(() => (init ? titleIn : urlIn).focus(), 30);
}

/** A closer look at a picture on the wall, with who hung it and ways to move, edit or take it down. */
export function openPicture(d: Decoration, actions: { move(): void; edit(): void; remove(): void }) {
  const release = holdPicture(d.url);
  const stage = h('div.picture-stage', {}, h('span.spinner'));
  loadPicture(d.url).then(
    (pic) => stage.replaceChildren(h('img', { src: pic.src, alt: d.title ?? t('toys.hang.picture') })),
    (err) => stage.replaceChildren(h('p.hang-status.error', {}, `⚠️ ${(err as Error).message}`)),
  );
  const link = h('a', { href: d.url, target: '_blank', rel: 'noopener noreferrer' }, t('toys.hang.original'));
  const close = h('button.btn.close', { type: 'button', 'aria-label': t('common.close') }, '✕');
  const takeDown = h('button.btn.danger', { type: 'button' }, t('toys.hang.takeDown'));
  const edit = h('button.btn', { type: 'button' }, `✏️ ${t('common.edit')}`);
  const move = h('button.btn.primary', { type: 'button' }, t('toys.hang.move'));
  const el = h(
    'div.modal.picture',
    { role: 'dialog', 'aria-label': d.title || t('toys.hang.picture') },
    h('header', {}, h('h2', {}, `🖼️ ${d.title || t('toys.hang.aPicture')}`), close),
    h('div.body', {}, stage, h('p.picture-meta', {}, `${t('toys.hang.hungByCap', { name: d.by })} · ${timeAgo(d.at)} · `, link)),
    h('footer', {}, takeDown, h('span.grow'), edit, move),
  );
  // Someone else took it down while you were looking.
  const unsub = store.on('decor', () => {
    if (!store.decor.some((x) => x.id === d.id)) modal.close();
  });
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      release();
    },
  });
  close.addEventListener('click', () => modal.close());
  move.addEventListener('click', () => {
    modal.close();
    actions.move();
  });
  edit.addEventListener('click', () => {
    modal.close();
    actions.edit();
  });
  takeDown.addEventListener('click', () =>
    confirmDialog(t('toys.hang.confirm'), t('toys.hang.confirmSub'), t('toys.hang.takeDown'), () => {
      modal.close();
      actions.remove();
    }),
  );
}
