// Phrases for the office's other windows and panels in ui/.
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';

export const en = {} as const satisfies Strings;

export const ar: Arabic<typeof en> = {};
