// Phrases for the things to do in the office: arcade, bar, games, the dog, golf, cars, the rooftop....
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';

export const en = {} as const satisfies Strings;

export const ar: Arabic<typeof en> = {};
