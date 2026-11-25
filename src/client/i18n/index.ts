/**
 * The office's languages: English and Arabic, picked per viewer in ⚙️ Settings and kept in this
 * browser. `t('key')` is a phrase in the language now, `tn('key', n)` one that changes with a count
 * (Intl.PluralRules, so Arabic gets its six forms), and `num`/`time` write numbers and times with
 * Latin digits in both. `onLang` hears a switch, which applies at once: the document turns
 * right-to-left and whatever listens redraws itself.
 *
 * How to add a phrase: put it in the English (`en`) of its area's file in `strings/`, then in the
 * Arabic (`ar`) beside it. The typecheck fails while the Arabic lacks it, and tests/i18n.test.ts
 * checks both have the same keys and the same {placeholders}.
 */
import { AR, EN, type Key, type PluralKey, type TextKey } from './dict';
import type { Plural } from './types';

export type { Key, PluralKey, TextKey };

export const LANGS = ['en', 'ar'] as const;
export type Lang = (typeof LANGS)[number];

/** What each language calls itself in the picker. */
export const LANG_NAME: Record<Lang, string> = { en: 'English', ar: 'العربية' };

const STORE_KEY = 'agent-office.lang';

/** Arabic for a browser whose first language is Arabic (ar, ar-EG, ar-SA...), English for any other. */
export function defaultLang(languages: readonly (string | undefined)[]): Lang {
  const first = languages.find((l) => !!l);
  return first && /^ar(-|_|$)/i.test(first) ? 'ar' : 'en';
}

/** The browser's own language list, or none outside a browser (the tests, the server). */
function browserLanguages(): string[] {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return [];
  return [...(navigator.languages ?? []), navigator.language];
}

/** What this browser picked before, if it did and can say. */
function saved(): Lang | null {
  if (typeof document === 'undefined') return null;
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v === 'en' || v === 'ar' ? v : null;
  } catch {
    return null;
  }
}

let current: Lang = saved() ?? defaultLang(browserLanguages());
const listeners = new Set<(l: Lang) => void>();

export function lang(): Lang {
  return current;
}

export function isRtl(l: Lang = current): boolean {
  return l === 'ar';
}

/** Switches the language for this viewer, remembers it in this browser, and tells everything that listens. */
export function setLang(l: Lang) {
  if (typeof document !== 'undefined') {
    try {
      localStorage.setItem(STORE_KEY, l);
    } catch {
      // storage blocked: it lasts until the page is closed
    }
  }
  if (l === current) return;
  current = l;
  applyDocument();
  // A copy: a listener may add another (Settings opens itself again), which must wait for the next switch.
  [...listeners].forEach((fn) => fn(l));
}

/** Hears every switch of language; hands back what stops it. */
export function onLang(fn: (l: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Puts the language and the reading direction on the page (lang="ar" dir="rtl"). */
export function applyDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
  document.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
}

/** The locale Intl formats with: Arabic words with Latin digits (0-9), as the owner's products write them. */
export function locale(l: Lang = current): string {
  return l === 'ar' ? 'ar-u-nu-latn' : 'en';
}

const pluralRules = new Map<Lang, Intl.PluralRules>();
function pluralForm(n: number, l: Lang): Intl.LDMLPluralRule {
  let rules = pluralRules.get(l);
  if (!rules) pluralRules.set(l, (rules = new Intl.PluralRules(locale(l))));
  return rules.select(n);
}

export type Vars = Readonly<Record<string, string | number>>;

/** Puts `vars` in the {holes} of `text`; a number goes in as `num` writes it. A hole with nothing for it stays. */
export function fill(text: string, vars?: Vars, l: Lang = current): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (hole, name: string) => {
    const v = vars[name];
    if (v === undefined) return hole;
    return typeof v === 'number' ? num(v, undefined, l) : v;
  });
}

function entry(key: string, l: Lang) {
  const table = (l === 'ar' ? AR : EN) as Record<string, string | Plural | undefined>;
  return table[key] ?? (EN as Record<string, string | Plural | undefined>)[key];
}

/** A phrase in the language now, with its {holes} filled from `vars`. */
export function t(key: TextKey, vars?: Vars): string {
  const e = entry(key, current);
  return fill(typeof e === 'string' ? e : key, vars);
}

/** A phrase that changes with `n` (its {n} is `n`, written as `num` writes it). */
export function tn(key: PluralKey, n: number, vars?: Vars): string {
  return pluralIn(current, key, n, vars);
}

/** `tn` in a given language, for the tests. */
export function pluralIn(l: Lang, key: PluralKey, n: number, vars?: Vars): string {
  const e = entry(key, l);
  if (!e || typeof e === 'string') return key;
  const form = pluralForm(n, l);
  const text = e[form] ?? e.other;
  return fill(text, { ...vars, n }, l);
}

/** `t` in a given language, for the tests and for pages that show both (the language picker). */
export function textIn(l: Lang, key: TextKey, vars?: Vars): string {
  const e = entry(key, l);
  return fill(typeof e === 'string' ? e : key, vars, l);
}

/**
 * `text` kept left to right inside a sentence of either direction (a path, a branch, a command), for
 * plain text where an element can't go: a title, a toast, a canvas. It wraps it in Unicode's
 * left-to-right isolate (U+2066 ... U+2069), which shows nothing. In HTML, i18n/dom.ts's ltr() does it.
 */
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
export function ltrText(text: string): string {
  // An English page reads left to right anyway, and copied text stays free of the marks.
  return current === 'ar' ? LRI + text + PDI : text;
}

/**
 * A table of labels read in the language now: `labels({ idle: 'common.status.idle' }).idle` is
 * `t('common.status.idle')` each time it's read, so a table made once at load still follows a switch.
 */
export function labels<K extends string>(keys: Record<K, TextKey>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(keys) as K[]) Object.defineProperty(out, k, { get: () => t(keys[k]), enumerable: true });
  return out;
}

const numberFormats = new Map<string, Intl.NumberFormat>();
/** A number in the language now, with Latin digits: 1,234.5 in both. */
export function num(n: number, opts?: Intl.NumberFormatOptions, l: Lang = current): string {
  const k = `${l}|${opts ? JSON.stringify(opts) : ''}`;
  let f = numberFormats.get(k);
  if (!f) numberFormats.set(k, (f = new Intl.NumberFormat(locale(l), opts)));
  return f.format(n);
}

/** A clock time (or date, with `opts`) in the language now, with Latin digits. */
export function time(at: Date | number, opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }, l: Lang = current): string {
  return new Intl.DateTimeFormat(locale(l), opts).format(at);
}

/** Joins a list the way the language does: "a, b and c" / "a وb وc". */
export function list(items: readonly string[], l: Lang = current): string {
  return new Intl.ListFormat(locale(l), { type: 'conjunction' }).format(items);
}
