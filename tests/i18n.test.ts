// The office's two languages: every phrase in both, with the same {holes}, Arabic's six plural forms,
// no long dashes, Latin digits, and the language a browser starts in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AREAS } from '../src/client/i18n/dict.js';
import { defaultLang, num, pluralIn, textIn, time } from '../src/client/i18n/index.js';
import { SERVER_RULES } from '../src/client/i18n/server.js';
import { textDir } from '../src/client/i18n/canvas.js';

type Entry = string | Record<string, string>;
const areas = Object.entries(AREAS) as [string, { en: Record<string, Entry>; ar: Record<string, Entry> }][];
const ARABIC_FORMS = ['zero', 'one', 'two', 'few', 'many', 'other'];
/** The en dash and the em dash, from their code points (so this file has neither). */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
/** Arabic-Indic digits, which the office never writes. */
const ARABIC_DIGITS = new RegExp(`[${String.fromCharCode(0x0660)}-${String.fromCharCode(0x0669)}]`);

/** The {holes} in a phrase, or in every form of a plural, sorted. */
function holes(e: Entry): string[] {
  const texts = typeof e === 'string' ? [e] : Object.values(e);
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1])))].sort();
}

/** What a translation lacks or has extra, by key. */
function keyDiff(en: object, ar: object) {
  const a = new Set(Object.keys(ar));
  const e = new Set(Object.keys(en));
  return { missing: [...e].filter((k) => !a.has(k)), extra: [...a].filter((k) => !e.has(k)) };
}

test('every phrase is in both languages, under its area’s name, in one area only', () => {
  const seen = new Map<string, string>();
  for (const [name, { en, ar }] of areas) {
    assert.deepEqual(keyDiff(en, ar), { missing: [], extra: [] }, `strings/${name}.ts: the Arabic and the English have different keys`);
    for (const key of Object.keys(en)) {
      assert.ok(key.startsWith(`${name}.`), `strings/${name}.ts: ${key} should start with "${name}."`);
      assert.ok(!seen.has(key), `${key} is in both strings/${seen.get(key)}.ts and strings/${name}.ts`);
      seen.set(key, name);
    }
  }
  assert.ok(seen.size > 100, `only ${seen.size} phrases`);
});

test('a missing key is caught: by the comparison, and by the typecheck', () => {
  assert.deepEqual(keyDiff({ 'x.a': 'A', 'x.b': 'B' }, { 'x.a': 'أ' }), { missing: ['x.b'], extra: [] });
  // The Arabic is typed from the English, so leaving a key out doesn't compile.
  const dir = mkdtempSync(path.join(tmpdir(), 'office-i18n-'));
  try {
    const types = path.join(import.meta.dirname, '../src/client/i18n/types.js').replace(/\\/g, '/');
    writeFileSync(
      path.join(dir, 'missing.ts'),
      `import type { Arabic } from '${types}';\nconst en = { 'x.a': 'A', 'x.b': 'B' } as const;\nexport const ar: Arabic<typeof en> = { 'x.a': 'أ' };\n`,
    );
    const tsc = path.join(import.meta.dirname, '../node_modules/typescript/bin/tsc');
    let out = '';
    try {
      execFileSync(process.execPath, [tsc, '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--skipLibCheck', path.join(dir, 'missing.ts')], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? '');
    }
    assert.match(out, /x\.b/, `the typecheck should fail on the missing key, said: ${out || 'nothing'}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('both languages fill the same {holes}, and no phrase has a long dash', () => {
  for (const [name, { en, ar }] of areas) {
    for (const key of Object.keys(en)) {
      assert.deepEqual(holes(ar[key]), holes(en[key]), `strings/${name}.ts: ${key} has different {holes} in Arabic`);
      for (const [l, e] of [['en', en[key]], ['ar', ar[key]]] as const) {
        const texts = typeof e === 'string' ? [e] : Object.values(e);
        for (const s of texts) assert.ok(!DASHES.test(s), `strings/${name}.ts: ${key} (${l}) has an en or em dash: ${s}`);
      }
    }
  }
});

test('plurals: English has one and other, Arabic all six forms, picked by Intl.PluralRules', () => {
  for (const [name, { en, ar }] of areas) {
    for (const [key, e] of Object.entries(en)) {
      if (typeof e === 'string') {
        assert.equal(typeof ar[key], 'string', `strings/${name}.ts: ${key} is a phrase in English but a plural in Arabic`);
        continue;
      }
      assert.ok(e.one !== undefined && e.other !== undefined, `strings/${name}.ts: ${key} needs one and other in English`);
      const a = ar[key];
      assert.ok(typeof a === 'object', `strings/${name}.ts: ${key} is a plural in English but not in Arabic`);
      assert.deepEqual(Object.keys(a).sort(), [...ARABIC_FORMS].sort(), `strings/${name}.ts: ${key} needs all six Arabic forms`);
    }
  }
  const ar = (n: number) => pluralIn('ar', 'common.workers', n);
  assert.equal(ar(0), 'لا عمّال');
  assert.equal(ar(1), 'عامل واحد');
  assert.equal(ar(2), 'عاملان');
  assert.equal(ar(3), '3 عمّال');
  assert.equal(ar(10), '10 عمّال');
  assert.equal(ar(11), '11 عاملًا');
  assert.equal(ar(99), '99 عاملًا');
  assert.equal(ar(100), '100 عامل');
  assert.equal(ar(1203), '1,203 عمّال');
  assert.equal(pluralIn('en', 'common.workers', 1), '1 worker');
  assert.equal(pluralIn('en', 'common.workers', 0), '0 workers');
  assert.equal(pluralIn('en', 'common.workers', 2), '2 workers');
});

test('interpolation, and numbers and times with Latin digits in Arabic', () => {
  assert.equal(textIn('en', 'common.closeEsc'), 'Close (Esc)');
  assert.equal(textIn('ar', 'common.closeEsc'), 'إغلاق (Esc)');
  assert.equal(num(1234567.5, undefined, 'ar'), '1,234,567.5');
  assert.equal(num(42, { style: 'percent' }, 'ar').replace(/[^\d]/g, ''), '4200');
  const clock = time(new Date(2026, 0, 1, 15, 7), { hour: 'numeric', minute: '2-digit' }, 'ar');
  assert.ok(/3:07/.test(clock) && !ARABIC_DIGITS.test(clock), clock);
});

test('the language a browser starts in: Arabic for an Arabic browser, else English', () => {
  assert.equal(defaultLang(['ar']), 'ar');
  assert.equal(defaultLang(['ar-EG', 'en-US']), 'ar');
  assert.equal(defaultLang(['AR-sa']), 'ar');
  assert.equal(defaultLang([undefined, 'ar-EG']), 'ar');
  assert.equal(defaultLang(['en-US', 'ar']), 'en');
  assert.equal(defaultLang(['fr-FR']), 'en');
  assert.equal(defaultLang(['arn']), 'en');
  assert.equal(defaultLang([]), 'en');
});

test('canvas labels read right to left only with Arabic in them', () => {
  assert.equal(textDir('Ada'), 'ltr');
  assert.equal(textDir('عمر'), 'rtl');
  assert.equal(textDir('Claude · عمر'), 'ltr');
});

test('every rule for the server’s words names a phrase with the holes it fills', () => {
  const all = Object.assign({}, ...areas.map(([, a]) => a.en)) as Record<string, Entry>;
  for (const [pattern, key, names] of SERVER_RULES) {
    assert.ok(all[key] !== undefined, `${pattern}: no phrase ${key}`);
    assert.deepEqual([...names].sort(), holes(all[key]), `${pattern}: fills ${names.join(', ')} but ${key} has ${holes(all[key]).join(', ')}`);
    assert.ok(pattern.source.startsWith('^') && pattern.source.endsWith('$'), `${pattern} should match the whole message`);
  }
});
