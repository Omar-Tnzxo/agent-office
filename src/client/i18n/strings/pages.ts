// Phrases for the pages besides the office: the 2D view (lite), join and claim.
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';

export const en = {} as const satisfies Strings;

export const ar: Arabic<typeof en> = {};
