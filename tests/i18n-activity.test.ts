// The office's words about a visitor's tool calls (its laptop, its Watch window) and what a visitor
// says handing a ticket over, read in Arabic (TOOL_RULES and SAY_RULES in src/client/i18n/server.ts),
// against what the server really writes (visitors/feed.ts toolHeadline, tickets/parse.ts sayOf).
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREAS } from '../src/client/i18n/dict.js';
import { setLang, textIn } from '../src/client/i18n/index.js';
import { SAY_RULES, TOOL_RULES, sayText, toolText } from '../src/client/i18n/server.js';
import { toolHeadline } from '../src/server/visitors/feed.js';
import { sayOf } from '../src/server/tickets/parse.js';

const all = Object.assign({}, ...Object.values(AREAS).map((a) => a.en)) as Record<string, string | object>;
const holesOf = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

test('each rule names a phrase with the holes it fills, matches whole lines, and is the first to catch its own', () => {
  for (const rules of [TOOL_RULES, SAY_RULES]) {
    for (const [pattern, key, names] of rules) {
      const en = all[key];
      assert.equal(typeof en, 'string', `${pattern}: no phrase ${key}`);
      assert.deepEqual([...names].sort(), holesOf(en as string), `${pattern}: fills ${names.join(', ')} but ${key} has others`);
      assert.ok(pattern.source.startsWith('^') && pattern.source.endsWith('$'), `${pattern} should match the whole line`);
      const english = textIn('en', key, Object.fromEntries(names.map((n) => [n, n === 'path' ? 'src/app' : 'Ada'])));
      assert.equal(rules.find(([p]) => p.test(english))?.[1], key, `"${english}" is caught by another rule before ${key}`);
    }
  }
});

test('a visitor’s tool calls as the server writes them read in Arabic, what they name carried over', () => {
  setLang('ar');
  try {
    const ar = (name: string, input: object, short = true) => toolText(toolHeadline(name, input, short));
    assert.equal(ar('Edit', { file_path: '/w/site/landing.md' }, false), 'يعدّل /w/site/landing.md');
    assert.match(ar('Write', { file_path: 'a/b.md' }), /^يكتب .*b\.md$/);
    assert.match(ar('Read', { file_path: 'a/b.md' }), /^يقرأ .*b\.md$/);
    assert.equal(ar('Grep', { pattern: 'budget', path: 'src' }, false), 'يبحث عن: budget في src');
    assert.equal(ar('Grep', { pattern: 'budget' }), 'يبحث عن: budget');
    assert.equal(ar('Glob', { pattern: '**/*.ts' }), 'يبحث عن ملفات **/*.ts');
    assert.equal(ar('WebSearch', { query: 'cairo rents' }), 'يبحث في الويب: cairo rents');
    assert.equal(ar('Agent', { description: 'Check the copy' }), 'وكيل فرعي: Check the copy');
    assert.equal(ar('TodoWrite', {}), 'يحدّث قائمة مهامه');
    assert.equal(ar('AskUserQuestion', { questions: [{ question: 'Which logo?' }] }), 'بانتظارك: Which logo?');
    assert.equal(ar('ExitPlanMode', {}), 'بانتظارك: خطته جاهزة');
    assert.equal(ar('ToolSearch', {}), 'يحمّل الأدوات');
    // A command, and anything no rule knows, stay as written.
    assert.equal(ar('Bash', { command: 'echo done' }), '$ echo done');
    assert.equal(toolText('x npm ERR! missing script'), 'x npm ERR! missing script');
    assert.equal(toolText('Stopped'), 'توقّف');
  } finally {
    setLang('en');
  }
  assert.equal(toolText('Editing landing.md'), 'Editing landing.md');
});

test('what a giver says handing a ticket over reads in Arabic, the stage’s name carried over', () => {
  setLang('ar');
  try {
    assert.equal(sayText(sayOf('return', 'returned: fix the numbers', 'copy-review')), 'مُعاد للتعديل');
    assert.equal(sayText(sayOf('review', 'copy written', 'copy')), 'Copy للمراجعة');
    assert.equal(sayText(sayOf('handoff', 'approved', 'copy-review')), 'Copy review ✔');
    assert.equal(sayText(sayOf('handoff', 'brief written', 'brief')), 'أُنجز: Brief');
    assert.equal(sayText(sayOf('handoff', 'written', undefined)), 'إليك');
    assert.equal(sayText(sayOf('handoff', 'approved', undefined)), 'تمت الموافقة ✔');
    assert.equal(sayText(sayOf('review', 'written', undefined)), 'جاهز للمراجعة');
    // Never a tool line's rules, and the other way round.
    assert.equal(toolText('Brief done'), 'Brief done');
    assert.equal(sayText('Editing landing.md'), 'Editing landing.md');
  } finally {
    setLang('en');
  }
});
