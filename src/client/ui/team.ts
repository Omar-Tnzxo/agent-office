import './team.css';
import type { ServerMsg, TeamState } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import { confirmDialog } from './prompt';
import { t, tn } from '../i18n';
import { rich } from '../i18n/dom';
import { serverText } from '../i18n/server';

export type Os = 'mac' | 'linux' | 'windows';
export const OS_LABEL: Record<Os, string> = { mac: 'macOS', linux: 'Linux', windows: 'Windows' };

export function guessOs(): Os {
  const p = navigator.userAgent;
  return /Windows/i.test(p) ? 'windows' : /Mac/i.test(p) ? 'mac' : 'linux';
}

/** Opens a URL in the browser, for ssh's LocalCommand. */
export function openCommand(url: string, os: Os): string {
  return os === 'mac' ? `open ${url}` : os === 'windows' ? `start ${url}` : `xdg-open ${url} >/dev/null 2>&1 &`;
}

/** One command that opens the tunnel and, once it's up, the office in their browser. */
export function tunnelCommand(t: TeamState, os: Os): string {
  // LocalCommand runs after the forward is listening, so the page loads on the first try.
  const open = openCommand(`http://localhost:${t.port}`, os);
  return `ssh -o ExitOnForwardFailure=yes -o PermitLocalCommand=yes -o LocalCommand="${open}" -L ${t.port}:localhost:${t.port} ${t.ssh}`;
}

// The invite messages are plain text pasted into a chat, so the command and links in them aren't
// wrapped in direction marks: they'd be copied along and break the command.
function inviteMessage(team: TeamState, os: Os): string {
  const project = store.project?.name ?? t('panels.team.our');
  return [
    t('panels.team.msg.run', { project, os: OS_LABEL[os] }),
    '',
    tunnelCommand(team, os),
    '',
    t('panels.team.msg.opens', { port: String(team.port) }),
    team.fingerprint ? t('panels.team.msg.trust', { fingerprint: team.fingerprint }) : '',
  ]
    .filter((l, i, all) => l || all[i - 1])
    .join('\n')
    .trim();
}

/** On an office on a Tailscale network: the link, and how to get onto the network. */
function tailnetMessage(team: TeamState): string {
  const project = store.project?.name ?? t('panels.team.our');
  return [t('panels.team.msg.tailnet', { project, url: `https://${team.tailnet}` }), '', t('panels.team.msg.tailnetHow')].join('\n');
}

const TAILSCALE_ADMIN = 'https://login.tailscale.com/admin';

export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not a secure context: fall back to a hidden textarea.
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function copyButton(label: string, text: () => string, cls = '') {
  const btn = h('button.btn', { type: 'button', class: cls }, label);
  btn.addEventListener('click', async () => {
    btn.textContent = (await copy(text())) ? `✓ ${t('common.copied')}` : t('panels.team.copyFailed');
    setTimeout(() => (btn.textContent = label), 1600);
  });
  return btn;
}

let onInvited: ((msg: Extract<ServerMsg, { t: 'team.invited' }>) => void) | null = null;

export function routeTeamMessage(msg: ServerMsg) {
  if (msg.t === 'team.invited') onInvited?.(msg);
}

export function openTeam(net: Net) {
  let os = guessOs();
  let status: HTMLElement | null = null;
  const body = h('div.body.team');
  const close = h('button.btn.close', { 'aria-label': t('common.close') }, '✕');
  const message = (team: TeamState) => (team.tailnet ? tailnetMessage(team) : inviteMessage(team, os));
  const copyMsg = copyButton(t('panels.team.copyMsg'), () => (store.team ? message(store.team) : ''), 'primary');
  const footer = h('footer', {}, h('span.grow', {}, t('panels.team.foot')), copyMsg);
  const el = h('div.modal', { role: 'dialog', 'aria-label': t('panels.team.label'), style: 'width:min(680px,100%)' }, h('header', {}, h('h2', {}, t('panels.team.title')), close), body, footer);

  const input = h('input', { type: 'text', maxlength: 40, placeholder: t('panels.team.user'), 'aria-label': t('panels.team.user'), autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const inviteBtn = h('button.btn.primary', { type: 'submit' }, t('panels.team.invite'));
  const form = h('form.invite-row', {}, input, inviteBtn) as HTMLFormElement;
  const setStatus = (text: string, kind: 'busy' | 'ok' | 'error') => {
    status = h('p.team-status', { class: kind }, text);
    render();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const github = input.value.trim();
    if (!github) return input.focus();
    inviteBtn.disabled = true;
    setStatus(t('panels.team.fetching', { name: github }), 'busy');
    net.send({ t: 'team.invite', github });
  });

  let focused = false;
  const render = () => {
    const team = store.team;
    const typing = document.activeElement === input;
    body.replaceChildren();
    if (!team) return body.append(h('p.empty', {}, t('common.loading')));
    footer.classList.toggle('hidden', !!team.unavailable);
    if (team.unavailable) return body.append(h('p', { style: 'margin:0;font-weight:700' }, serverText(team.unavailable)));
    if (team.tailnet) return renderTailnet(team);

    body.append(
      h('label', {}, t('panels.team.byUser')),
      form,
      h('p.note', {}, ...rich('panels.team.keys', { url: h('code', {}, 'github.com/<username>.keys') })),
    );
    if (status) body.append(status);
    if (team.error) body.append(h('p.team-status.error', {}, serverText(team.error)));

    const tabs = h(
      'div.os-tabs',
      {},
      ...(Object.keys(OS_LABEL) as Os[]).map((o) =>
        h('button.btn', { type: 'button', class: o === os ? 'on' : '', onclick: () => ((os = o), render()) }, OS_LABEL[o]),
      ),
    );
    body.append(
      h('div.team-head', {}, h('h4', {}, t('panels.team.send')), tabs),
      h('div.cmd', {}, h('pre', {}, tunnelCommand(team, os)), copyButton(t('common.copy'), () => tunnelCommand(team, os))),
      h(
        'p.note',
        {},
        ...rich('panels.team.opens', { url: h('code', {}, `http://localhost:${team.port}`) }),
        team.fingerprint ? h('span', {}, ...rich('panels.team.fingerprint', { fp: h('code', {}, team.fingerprint) })) : null,
      ),
    );
    // Railway's TCP proxy, a Fly.io app's IP address and the port Dokploy or Coolify publishes
    // (addresses with a port of their own) answer every IP; AWS's firewall doesn't.
    if (!team.ssh?.startsWith('ssh://')) {
      body.append(h('p.note', {}, ...rich('panels.team.allow', { cmd: h('code', {}, `${team.deploy ?? 'deploy/aws.sh'} allow <their-ip>`), any: h('code', {}, 'allow anywhere') })));
    }

    body.append(h('h4', {}, t('panels.team.invited'), h('span.count', {}, String(team.members.length))), memberList(team));
    if (typing || !focused) setTimeout(() => input.focus(), 30);
    focused = true;
  };

  // Tailscale decides who gets in: the panel says how to let someone onto the network.
  const renderTailnet = (team: TeamState) => {
    const url = `https://${team.tailnet}`;
    const link = (path: string, text: string) => h('a', { href: `${TAILSCALE_ADMIN}/${path}`, target: '_blank', rel: 'noopener' }, text);
    body.append(
      h('label', {}, t('panels.team.tailnet')),
      h('div.cmd', {}, h('pre', {}, url), copyButton(t('common.copy'), () => url)),
      h('p.note', {}, t('panels.team.tailnet.note')),
      h('h4', {}, t('panels.team.notOn')),
      h('p.note', {}, ...rich('panels.team.share', { machines: link('machines', 'Machines'), host: h('code', {}, team.tailnet!.split('.')[0]), users: link('users', 'Users') })),
    );
    if (status) body.append(status);
    if (team.error) body.append(h('p.team-status.error', {}, serverText(team.error)));
    // People invited before the office went on the tailnet can still tunnel in, until they're removed.
    if (team.members.length) body.append(h('h4', {}, t('panels.team.bySsh'), h('span.count', {}, String(team.members.length))), memberList(team));
  };

  const memberList = (team: TeamState) => {
    const list = h('ul.team-list');
    for (const m of team.members) {
      const remove = h('button.btn', { type: 'button', title: t('panels.team.remove.title', { name: m.name }) }, t('common.remove'));
      remove.addEventListener('click', () =>
        confirmDialog(
          t('panels.team.remove.q', { name: m.name }),
          t('panels.team.remove.body', { name: m.name }),
          t('common.remove'),
          () => net.send({ t: 'team.remove', name: m.name }),
        ),
      );
      list.append(h('li', {}, h('span.name', {}, m.name), h('span.keys', {}, tn('panels.team.keysN', m.keys)), remove));
    }
    if (!team.members.length) list.append(h('li.empty', {}, t('panels.team.nobody')));
    return list;
  };

  onInvited = (msg) => {
    inviteBtn.disabled = false;
    if (msg.error) return setStatus(serverText(msg.error), 'error');
    input.value = '';
    setStatus(tn('panels.team.invitedOk', msg.keys ?? 0, { name: msg.name ?? '' }), 'ok');
  };
  const unsub = store.on('team', render);
  const modal = openModal(el, {
    onClose: () => {
      unsub();
      onInvited = null;
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  net.send({ t: 'team.get' });
}
