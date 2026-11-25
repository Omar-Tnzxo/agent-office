// Phrases for the desks and their workers: features/workers, visitors, needsyou, subagents, peers, boards, meeting, palette, voice, chat, dictation, whiteboard, tv, waiting, walking.
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';

export const en = {} as const satisfies Strings;

export const ar: Arabic<typeof en> = {};
