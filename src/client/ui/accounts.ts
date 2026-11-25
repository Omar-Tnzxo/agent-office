import './accounts.css';
import type { AccountInvite, AccountRole, ServerMsg } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { confirmDialog } from './prompt';
import { copyButton } from './team';
import { ltrText, t, tn } from '../i18n';
import { serverText } from '../i18n/server';

export const inviteLink = (v: AccountInvite) => `${location.origin}/join#${v.token}`;

function expiresIn(at: number): string {
  const d = Math.round((at - Date.now()) / 86_400_000);
  return d >= 1 ? tn('panels.acc.expiresIn', d) : t('panels.acc.expiresToday');
}

const roleName = (role: AccountRole) => t(role === 'admin' ? 'settings.role.admin' : 'settings.role.member');

let onInvited: ((msg: Extract<ServerMsg, { t: 'accounts.invited' }>) => void) | null = null;

export function routeAccountsMessage(msg: ServerMsg) {
  if (msg.t === 'accounts.invited') onInvited?.(msg);
}

/** 🔑 Accounts, for admins: invite people by link, list them, change their role or revoke them. */
export function openAccounts(net: Net) {
  let status: HTMLElement | null = null;
  /** The invite just made, shown big until the next one. */
  let fresh: AccountInvite | null = null;
  const body = h('div.body.team.accounts');
  const close = h('button.btn.close', { 'aria-label': t('common.close') }, '✕');
  const signedInAs = h('span.grow');
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': t('panels.acc.label'), style: 'width:min(680px,100%)' },
    h('header', {}, h('h2', {}, t('panels.acc.title')), close),
    body,
    h('footer', {}, signedInAs),
  );

  const nameInput = h('input', { type: 'text', maxlength: 24, placeholder: t('panels.acc.name.placeholder'), 'aria-label': t('panels.acc.name'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const roleSelect = h('select', { 'aria-label': t('panels.acc.role') }, h('option', { value: 'member' }, t('panels.acc.member')), h('option', { value: 'admin' }, t('panels.acc.admin'))) as HTMLSelectElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, t('panels.acc.make'));
  const form = h('form.invite-row', {}, nameInput, roleSelect, inviteBtn) as HTMLFormElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    inviteBtn.disabled = true;
    net.send({ t: 'accounts.invite', name: nameInput.value.trim() || undefined, role: roleSelect.value as AccountRole });
  });

  const render = () => {
    const s = store.accounts;
    const me = store.me;
    signedInAs.textContent = me.account ? t('panels.acc.signedInAs', { name: me.account.name, role: roleName(me.account.role) }) : t('panels.acc.signedInShared');
    const typing = document.activeElement === nameInput;
    body.replaceChildren();
    if (!s) return body.append(h('p.empty', {}, t('common.loading')));

    body.append(
      h('label', {}, t('panels.acc.invite')),
      form,
      h('p.note', {}, t('panels.acc.invite.note')),
    );
    if (status) body.append(status);
    if (fresh) {
      const v = fresh;
      body.append(h('div.cmd', {}, h('pre', {}, inviteLink(v)), copyButton(t('common.copy'), () => inviteLink(v))));
    }
    if (store.invites) body.append(h('p.note', {}, t('panels.acc.wayIn')));

    const list = h('ul.team-list');
    for (const a of s.accounts) {
      const you = me.account?.name === a.name;
      const seen = a.online ? t('panels.acc.inOffice') : a.lastSeenAt ? t('panels.acc.seen', { when: timeAgo(a.lastSeenAt) }) : t('panels.acc.never');
      const role = h('button.btn', { type: 'button', title: a.role === 'admin' ? t('panels.acc.demote.title') : t('panels.acc.promote.title') }, a.role === 'admin' ? t('panels.acc.demote') : t('panels.acc.promote'));
      role.addEventListener('click', () => net.send({ t: 'accounts.role', accountId: a.id, role: a.role === 'admin' ? 'member' : 'admin' }));
      const revoke = h('button.btn.danger', { type: 'button', title: t('panels.acc.revoke.title', { name: a.name }) }, t('panels.acc.revoke'));
      revoke.addEventListener('click', () =>
        confirmDialog(
          t('panels.acc.revoke.q', { name: a.name }),
          `${t('panels.acc.revoke.body')} ${s.sharedPassword ? t('panels.acc.revoke.shared', { name: a.name }) : ''}`,
          t('panels.acc.revoke'),
          () => net.send({ t: 'accounts.revoke', accountId: a.id }),
        ),
      );
      list.append(
        h(
          'li',
          {},
          h('span.dot', { class: a.online ? 'on' : '', title: seen }),
          h('span.name', {}, a.name, you ? h('span.you', {}, t('panels.acc.you')) : null),
          h('span.role', { class: a.role }, roleName(a.role)),
          h('span.keys', { title: t('panels.acc.invitedBy', { who: a.createdBy }) }, seen),
          you ? null : role,
          you ? null : revoke,
        ),
      );
    }
    if (!s.accounts.length) list.append(h('li.empty', {}, t('panels.acc.nobody')));
    body.append(h('h4', {}, t('panels.acc.people'), h('span.count', {}, String(s.accounts.length))), list);

    if (s.invites.length) {
      const invites = h('ul.team-list');
      for (const v of s.invites) {
        const cancel = h('button.btn', { type: 'button', title: t('panels.acc.cancel.title') }, t('common.cancel'));
        cancel.addEventListener('click', () => {
          if (fresh?.id === v.id) fresh = null;
          net.send({ t: 'accounts.cancel', inviteId: v.id });
        });
        invites.append(
          h(
            'li',
            {},
            h('span.name', {}, v.name ?? h('i', {}, t('panels.acc.theyPick'))),
            h('span.role', { class: v.role }, roleName(v.role)),
            h('span.keys', { title: t('panels.acc.madeBy', { who: v.createdBy, when: timeAgo(v.createdAt) }) }, expiresIn(v.expiresAt)),
            copyButton(t('panels.acc.copyLink'), () => inviteLink(v)),
            cancel,
          ),
        );
      }
      body.append(h('h4', {}, t('panels.acc.open'), h('span.count', {}, String(s.invites.length))), invites);
    }

    // The shared password: the old way in, kept as a fallback until everyone has an account.
    const toggle = h('button.btn', { type: 'button', class: s.sharedPassword ? 'danger' : '' }, s.sharedPassword ? t('panels.acc.off') : t('panels.acc.on'));
    const canSwitchOff = me.account?.role === 'admin';
    if (s.sharedPassword && !canSwitchOff) toggle.setAttribute('disabled', '');
    toggle.addEventListener('click', () => {
      if (!s.sharedPassword) return net.send({ t: 'accounts.shared', on: true });
      confirmDialog(
        t('panels.acc.off.q'),
        t('panels.acc.off.body'),
        t('panels.acc.off'),
        () => net.send({ t: 'accounts.shared', on: false }),
      );
    });
    body.append(
      h('div.team-head', {}, h('h4', {}, t('panels.acc.shared')), toggle),
      h(
        'p.note',
        {},
        s.sharedPassword ? t('panels.acc.shared.on') : t('panels.acc.shared.off', { cmd: ltrText('agent-office accounts password on') }),
        s.sharedPassword && !canSwitchOff ? h('b', {}, t('panels.acc.shared.first')) : null,
      ),
    );
    if (typing) nameInput.focus();
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error || !msg.invite) {
      status = h('p.team-status.error', {}, msg.error ? serverText(msg.error) : t('panels.acc.inviteFailed'));
      return render();
    }
    fresh = msg.invite;
    nameInput.value = '';
    status = h('p.team-status.ok', {}, msg.invite.name ? t('panels.acc.sendTo', { name: msg.invite.name }) : t('panels.acc.sendToThem'));
    render();
  };
  // No longer an admin (someone changed your role): the list isn't yours to see any more.
  const unsubs = [store.on('accounts', render), store.on('me', () => (store.me.admin ? render() : modal.close()))];
  const modal = openModal(el, {
    onClose: () => {
      unsubs.forEach((u) => u());
      onInvited = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => nameInput.focus(), 30);
  net.send({ t: 'accounts.get' });
}
