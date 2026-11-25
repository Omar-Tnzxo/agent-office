import { onLang, t } from './i18n';
import { installPageLanguage, langSwitch } from './i18n/dom';
import { serverText } from './i18n/server';

// One-time password reveal: /claim?t=<token>. The server forgets the plaintext as soon as it answers.
installPageLanguage('pages.claim.title');
document.querySelector('main.card')!.prepend(langSwitch());

const $ = (id: string) => document.getElementById(id)!;
const token = new URLSearchParams(location.search).get('t') ?? '';
// Keep the single-use token out of the address bar and history.
history.replaceState(null, '', '/claim');

/** The error shown, in the language at the time: written again after a switch. */
let paintError = () => {};
onLang(() => paintError());

function fail(say: () => string) {
  const sub = $('sub');
  delete sub.dataset.i18n;
  sub.textContent = '';
  paintError = () => void ($('error').textContent = say());
  paintError();
  $('login').hidden = false;
}

async function claim() {
  if (!token) return fail(() => t('pages.claim.noToken'));
  try {
    const res = await fetch('/api/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const said: string | undefined = body.error;
      return fail(() => (said ? serverText(said) : t('pages.claim.failed')));
    }
    // The data-i18n on it is what a switch of language fills it with.
    $('sub').dataset.i18n = 'pages.claim.lastThing';
    $('sub').textContent = t('pages.claim.lastThing');
    $('pw').textContent = body.password;
    $('reveal').hidden = false;
  } catch {
    fail(() => t('common.serverUnreachable'));
  }
}

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('pw').textContent ?? '');
    $('copy').dataset.i18n = 'common.copied';
    $('copy').textContent = t('common.copied');
  } catch {
    getSelection()?.selectAllChildren($('pw'));
  }
});
($('saved') as HTMLInputElement).addEventListener('change', (e) => {
  ($('enter') as HTMLButtonElement).disabled = !(e.target as HTMLInputElement).checked;
});
$('enter').addEventListener('click', () => location.replace('/'));
window.addEventListener('beforeunload', (e) => {
  if (!$('reveal').hidden && !($('saved') as HTMLInputElement).checked) e.preventDefault();
});
void claim();
