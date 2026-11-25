import './signins.css';
import type { SignInKind, SignInState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, type Modal } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';
import { t } from '../i18n';
import { rich } from '../i18n/dom';
import { serverText } from '../i18n/server';

const NAMES: Record<SignInKind, string> = { claude: 'Claude', github: 'GitHub' };

let open: { modal: Modal; say(why?: string): void } | null = null;

/**
 * 🔐 Your sign-ins: the Claude plan your workers run on and the GitHub account the office acts as
 * for you, both your own (see server/signins.ts). The office runs the sign-in itself and hands you
 * the page to open; or paste a token; admins may use the office machine's own instead.
 * `why` says what sent you here (hiring a worker before signing in, say).
 */
export function openSignIns(net: Net, why?: string) {
  if (open) return open.say(why);
  const close = h('button.btn.close', { 'aria-label': t('common.close') }, '✕');
  const banner = h('p.team-status', { hidden: true });
  const cards = h('div.signins');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('panels.si.label'), style: 'width:min(640px,100%)' },
    h('header', {}, h('h2', {}, t('panels.si.title')), close),
    h(
      'div.body.team',
      {},
      h('p.note.lead', {}, t('panels.si.lead')),
      banner,
      cards,
      h('p.note', {}, ...rich('panels.si.shell', { a: h('code', {}, 'claude auth login'), b: h('code', {}, 'gh auth login') })),
    ),
  );

  // Kept across renders, so a half-typed code or token survives the next update.
  const inputs = {
    code: h('input', { type: 'text', placeholder: t('panels.si.code'), 'aria-label': t('panels.si.code.aria'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
    claude: h('input', { type: 'password', placeholder: 'sk-ant-oat01-…', 'aria-label': t('panels.si.claudeToken'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
    github: h('input', { type: 'password', placeholder: t('panels.si.ghPlaceholder'), 'aria-label': t('panels.si.ghToken'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement,
  };

  const say = (text?: string) => {
    banner.hidden = !text;
    banner.textContent = text ?? '';
  };

  const button = (label: string, onClick: () => void, cls = '') => {
    const b = h('button.btn', { type: 'button', class: cls }, label);
    b.addEventListener('click', onClick);
    return b;
  };

  const tokenRow = (which: SignInKind) => {
    const input = inputs[which];
    const save = h('button.btn', { type: 'submit' }, t('common.save'));
    const form = h('form.invite-row', {}, input, save) as HTMLFormElement;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const token = input.value.trim();
      if (!token) return input.focus();
      net.send({ t: 'signins.token', which, token });
      input.value = '';
    });
    return form;
  };

  const card = (which: SignInKind, s: SignInState, office: boolean) => {
    const status =
      s.status === 'ok'
        ? h('span.signin-who.ok', {}, '✅ ', s.how === 'office' ? (s.who ? t('panels.si.officeWho', { who: s.who }) : t('panels.si.office')) : (s.who ?? t('panels.si.signedIn')))
        : s.status === 'busy'
          ? h('span.signin-who', {}, t('panels.si.signingIn'))
          : h('span.signin-who.none', {}, t('panels.si.notSignedIn'));
    const head = h('div.team-head', {}, h('h4', {}, which === 'claude' ? '✳️ Claude' : '🐙 GitHub'), status);
    const body = h('div.signin-body');
    const box = h('section.signin', { class: s.status }, head, body);
    if (s.error) body.append(h('p.team-status.error', {}, serverText(s.error)));

    if (s.pending) {
      const url = s.pending.url && /^https:\/\//.test(s.pending.url) ? s.pending.url : undefined;
      if (!url) {
        body.append(h('p.note', {}, t('panels.si.starting', { name: NAMES[which] })));
      } else if (which === 'claude') {
        const send = h('button.btn.primary', { type: 'submit' }, s.pending.sent ? t('panels.si.checking') : t('common.send'));
        if (s.pending.sent) send.setAttribute('disabled', '');
        const form = h('form.invite-row', {}, inputs.code, send) as HTMLFormElement;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const code = inputs.code.value.trim();
          if (!code) return inputs.code.focus();
          net.send({ t: 'signins.code', code });
          inputs.code.value = '';
        });
        body.append(
          h('ol.signin-steps', {}, h('li', {}, ...rich('panels.si.claudeOpen', { link: h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, t('panels.si.claudeLink')) })), h('li', {}, t('panels.si.claudeCode'), form)),
        );
      } else {
        const code = s.pending.code ?? '';
        body.append(
          h(
            'ol.signin-steps',
            {},
            h('li', {}, t('panels.si.ghCopy'), h('div.cmd', {}, h('pre.signin-code', {}, code), copyButton(t('common.copy'), () => code))),
            h('li', {}, ...rich('panels.si.ghOpen', { link: h('a.btn.primary', { href: url, target: '_blank', rel: 'noopener noreferrer' }, t('panels.si.ghLink')) })),
            h('li', {}, t('panels.si.ghWait')),
          ),
        );
      }
      body.append(h('div.signin-actions', {}, button(t('common.cancel'), () => net.send({ t: 'signins.cancel', which }))));
      return box;
    }

    if (s.status === 'ok') {
      const change = button(s.how === 'office' ? t('panels.si.useMine') : t('panels.si.signOut'), () => {
        if (s.how === 'office') return net.send({ t: 'signins.signout', which });
        confirmDialog(t('panels.si.signOut.q', { name: NAMES[which] }), which === 'claude' ? t('panels.si.signOut.claude') : t('panels.si.signOut.github'), t('panels.si.signOut'), () => net.send({ t: 'signins.signout', which }));
      });
      body.append(h('div.signin-actions', {}, change));
      return box;
    }

    // Not signed in (or busy looking): the ways in.
    const start = button(t('panels.si.signInWith', { name: NAMES[which] }), () => net.send({ t: 'signins.start', which }), 'primary');
    const actions = h('div.signin-actions', {}, start);
    if (office) actions.append(button(t('panels.si.useOffice'), () => net.send({ t: 'signins.office', which })));
    body.append(
      actions,
      which === 'claude'
        ? h('p.note', {}, ...rich('panels.si.claudeToken.note', { cmd: h('code', {}, 'claude setup-token') }))
        : h('p.note', {}, ...rich('panels.si.ghToken.note', { link: h('a', { href: 'https://github.com/settings/tokens/new?scopes=repo,read:org,workflow&description=Agent%20Office', target: '_blank', rel: 'noopener noreferrer' }, t('panels.si.makeOne')) })),
      tokenRow(which),
    );
    return box;
  };

  const render = () => {
    const s = store.signins;
    const typing = document.activeElement;
    cards.replaceChildren();
    if (!s) {
      cards.append(h('p.empty', {}, store.me.account ? t('common.loading') : t('panels.si.shared')));
      return;
    }
    cards.append(card('claude', s.claude, s.office), card('github', s.github, s.office));
    if (typing instanceof HTMLInputElement && Object.values(inputs).includes(typing) && typing.isConnected) typing.focus();
    // Once both are sorted, whatever sent you here is too.
    if (s.claude.status === 'ok' && s.github.status === 'ok') say();
  };

  const unsub = store.on('signins', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      open = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  open = { modal, say };
  say(why);
  render();
  net.send({ t: 'signins.get' });
}

/** Whether the panel should greet someone who just came in: their Claude sign-in still to do. */
export function needsSigningIn(): boolean {
  const s = store.signins;
  return !!store.me.account && !!s && s.claude.status === 'none' && s.claude.how === 'login';
}
