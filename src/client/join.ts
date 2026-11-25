import { onLang, t } from './i18n';
import { installPageLanguage, langSwitch, rich } from './i18n/dom';
import { serverText } from './i18n/server';

// An invite link, /join#<token>: make your own account, then walk in. The token rides in the
// fragment, so it never reaches a server log or a Referer header.
installPageLanguage('pages.join.title');
document.querySelector('main.card')!.prepend(langSwitch());

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const token = location.hash.slice(1);
const form = $<HTMLFormElement>('form');
const name = $<HTMLInputElement>('name');
const password = $<HTMLInputElement>('password');
const again = $<HTMLInputElement>('again');
const submit = $<HTMLButtonElement>('submit');
const error = $('error');

/** What the page says now that isn't in the .html: written again after a switch of language. */
let paintInvite = () => {};
let paintError = () => {};
onLang(() => {
  paintInvite();
  paintError();
});

/** Shows an error, `say` giving its words in the language at the time. */
function showError(say: (() => string) | undefined) {
  paintError = () => void (error.textContent = say ? say() : '');
  paintError();
}

function fail(say: () => string) {
  const sub = $('sub');
  delete sub.dataset.i18n;
  sub.textContent = '';
  form.hidden = true;
  showError(say);
  $('login').hidden = false;
}

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; body: any }> {
  const res = await fetch('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...body }) });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

async function peek() {
  if (!token) return fail(() => t('pages.join.noCode'));
  try {
    const r = await post({ peek: true });
    if (!r.ok) {
      const said: string | undefined = r.body.error;
      return fail(() => (said ? serverText(said) : t('pages.join.broken')));
    }
    const { name: invited, role, by, project } = r.body as { name?: string; role: string; by: string; project: string };
    const title = $('title');
    const sub = $('sub');
    // Theirs from here on, not the .html's.
    delete title.dataset.i18n;
    delete sub.dataset.i18n;
    paintInvite = () => {
      title.textContent = t('pages.join.heading', { project });
      if (role === 'admin') {
        const pill = document.createElement('span');
        pill.className = 'role';
        pill.textContent = t('pages.join.admin');
        sub.replaceChildren(...rich('pages.join.byAdmin', { role: pill }, { by }));
      } else sub.replaceChildren(t('pages.join.by', { by }));
      sub.append(' ', t('pages.join.makeAccount'));
      if (invited) name.title = t('pages.join.nameTitle');
    };
    paintInvite();
    if (invited) {
      name.value = invited;
      name.readOnly = true;
    }
    form.hidden = false;
    (invited ? password : name).focus();
  } catch {
    fail(() => t('common.serverUnreachable'));
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError(undefined);
  if (password.value !== again.value) {
    showError(() => t('pages.join.mismatch'));
    again.select();
    return;
  }
  submit.disabled = true;
  try {
    const r = await post({ name: name.value.trim(), password: password.value });
    if (!r.ok) {
      const said: string | undefined = r.body.error;
      showError(() => (said ? serverText(said) : t('pages.join.failed')));
      return;
    }
    try {
      localStorage.setItem('agent-office.login-name', r.body.name);
    } catch {
      // storage blocked
    }
    location.replace('/');
  } catch {
    showError(() => t('common.serverUnreachable'));
  } finally {
    submit.disabled = false;
  }
});

void peek();
