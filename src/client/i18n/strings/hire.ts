// Phrases for hiring and what a worker starts on: ui/prompt, ui/provider, ui/prompts, ui/repos.
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';

export const en = {} as const satisfies Strings;

export const ar: Arabic<typeof en> = {};
