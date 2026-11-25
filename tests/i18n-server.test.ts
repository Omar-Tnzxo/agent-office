// The rules that say the server's English in the viewer's language (src/client/i18n/server.ts), against
// the server's own words: every string and template literal under src/server, with each ${...} as a
// marker. A rule that matches one must take whole markers for the names it carries, so it can't read
// part of a longer message ("Could not start claude: whoever hired Ada...") as somebody's name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SERVER_RULES, serverText } from '../src/client/i18n/server.js';
import { setLang } from '../src/client/i18n/index.js';

const server = path.join(import.meta.dirname, '../src/server');

/** A marker for one ${...} of a template. */
const mark = (i: number) => `⟦${i}⟧`;
const MARKS = /^(?:⟦\d+⟧)+$/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
}

/** The string and template literals of a source file (comments skipped), each ${...} a marker, with its line. */
function literals(src: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const lineAt = (i: number) => src.slice(0, i).split('\n').length;
  let i = 0;
  /** Reads a template from just after its backtick to just after its closing one. */
  const template = (): string => {
    let text = '';
    let n = 0;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') {
        text += src[i + 1];
        i += 2;
      } else if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < src.length && depth) {
          if (src[i] === '`') {
            i++;
            template();
            continue;
          }
          if (src[i] === "'" || src[i] === '"') {
            quoted(src[i]);
            continue;
          }
          if (src[i] === '{') depth++;
          if (src[i] === '}') depth--;
          i++;
        }
        text += mark(n++);
      } else text += src[i++];
    }
    i++;
    return text;
  };
  const quoted = (q: string): string => {
    let text = '';
    i++;
    while (i < src.length && src[i] !== q && src[i] !== '\n') {
      if (src[i] === '\\') {
        text += src[i + 1];
        i += 2;
      } else text += src[i++];
    }
    i++;
    return text;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i) === -1 ? src.length : src.indexOf('\n', i);
    else if (c === '/' && src[i + 1] === '*') i = src.indexOf('*/', i) + 2;
    else if (c === '`') {
      const at = i++;
      out.push({ text: template(), line: lineAt(at) });
    } else if (c === "'" || c === '"') {
      const at = i;
      out.push({ text: quoted(c), line: lineAt(at) });
    } else i++;
  }
  return out;
}

/** The holes that carry a name or a number: a rule must fill each with whole markers only. */
const NAMES = new Set(['who', 'name', 'n', 'branch', 'kept', 'desk']);

const found = files(server).flatMap((file) => literals(readFileSync(file, 'utf8')).map((l) => ({ ...l, where: `${path.relative(server, file)}:${l.line}` })));
const messages = found.filter((l) => / /.test(l.text) && l.text.length >= 8);

test('the server’s messages are read whole: a name never takes in part of a longer message', () => {
  assert.ok(messages.length > 500, `found only ${messages.length} literals under src/server`);
  const wrong: string[] = [];
  let matched = 0;
  for (const { text, where } of messages) {
    for (const [pattern, key, holes] of SERVER_RULES) {
      const m = pattern.exec(text);
      if (!m) continue;
      matched++;
      holes.forEach((hole, i) => {
        if (NAMES.has(hole) && !MARKS.test((m[i + 1] ?? '').trim())) wrong.push(`${where}: "${text}" read by ${key} with ${hole} = "${m[i + 1]}"`);
      });
      break;
    }
  }
  assert.deepEqual(wrong, []);
  assert.ok(matched > 100, `only ${matched} of the server's messages match a rule`);
});

test('the messages the review found map to the right phrase, or are left alone', () => {
  setLang('ar');
  try {
    // manager.ts: an error that has "hired" in it is not a hire.
    const notSignedIn = `Could not start claude: whoever hired Ada (omar) isn't signed in to Claude ${String.fromCharCode(0x2014)} they can sign in under ☰ → 🔐 Your sign-ins, then press R here`;
    assert.equal(serverText(notSignedIn), notSignedIn);
    assert.equal(serverText(notSignedIn.slice('Could not start claude: '.length)), notSignedIn.slice('Could not start claude: '.length));
    assert.equal(serverText('Could not clone: owner/repo is already being cloned'), 'Could not clone: owner/repo is already being cloned');
    assert.equal(serverText('Error: Ada sent Bob home'), 'Error: Ada sent Bob home');
    assert.equal(serverText('Failed: Ada closed issue #3'), 'Failed: Ada closed issue #3');
    // And the real ones still do.
    assert.match(serverText('Ada hired Cosmic Yak'), /Cosmic Yak/);
    assert.notEqual(serverText('Ada hired Cosmic Yak'), 'Ada hired Cosmic Yak');
    assert.notEqual(serverText('owner/repo is already being cloned'), 'owner/repo is already being cloned');
    // Too long to be one of the server's own: shown as it came, without trying every rule on it.
    const long = `Ada hired ${'x'.repeat(500)}`;
    assert.equal(serverText(long), long);
  } finally {
    setLang('en');
  }
});
