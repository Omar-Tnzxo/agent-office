// Phrases for what the server says that the page shows as UI (toasts, errors), matched in ../server.ts.
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';

export const en = {} as const satisfies Strings;

export const ar: Arabic<typeof en> = {};
