/**
 * What the server says that the page shows as its own words: toasts ("Omar sent Ada home"), and the
 * errors of signing in or of a request. The server speaks English to everyone, so on an Arabic page
 * each message is matched against RULES and said again in Arabic, its names and numbers carried
 * over; one no rule knows stays as the server wrote it. Agent output never comes through here.
 *
 * How to add one: a rule with the server's words as a pattern (anchored, the names as groups), the
 * key it becomes, and what each group is called in that key's {holes}; then the key in
 * strings/server.ts, in both languages.
 */
import { lang, t, type TextKey } from '.';

type Rule = readonly [pattern: RegExp, key: TextKey, holes: readonly string[]];

const RULES: readonly Rule[] = [];

/** `text` from the server, in the page's language when a rule knows it. */
export function serverText(text: string): string {
  if (lang() === 'en') return text;
  for (const [pattern, key, holes] of RULES) {
    const m = pattern.exec(text);
    if (m) return t(key, Object.fromEntries(holes.map((name, i) => [name, m[i + 1] ?? ''])));
  }
  return text;
}

/** The rules, for the tests: each key exists and has the holes its rule fills. */
export const SERVER_RULES = RULES;
