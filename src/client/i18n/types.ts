/**
 * The shapes of the office's words. English is the source: every area of the page has a file in
 * `strings/` with its English (`en`) and its Arabic (`ar`), and `ar` is typed from `en`, so a key
 * missing from the Arabic, or one the English doesn't have, fails the typecheck.
 */

/** A phrase that changes with a count. English needs `one` and `other`; `n` in the text is the count. */
export interface Plural {
  readonly zero?: string;
  readonly one: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

/** Arabic has all six of Intl.PluralRules' forms: 0, 1, 2, 3 to 10, 11 to 99, and the rest (100, 101...). */
export interface ArabicPlural {
  readonly zero: string;
  readonly one: string;
  readonly two: string;
  readonly few: string;
  readonly many: string;
  readonly other: string;
}

export type Entry = string | Plural;

/** One area's English: keys to phrases. Keys start with the area's name (`settings.`, `hud.`). */
export type Strings = Readonly<Record<string, Entry>>;

/** The Arabic for an area's English: the same keys, a string for a string and all six forms for a plural. */
export type Arabic<T extends Strings> = { readonly [K in keyof T]: T[K] extends string ? string : ArabicPlural };
