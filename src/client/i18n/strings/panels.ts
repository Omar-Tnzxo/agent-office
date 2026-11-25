// Phrases for the office's other windows and panels in ui/. The area is split over files to stay
// under the size budget: panels-office.ts, panels-people.ts and panels-help.ts hold its parts, merged here.
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';
import * as help from './panels-help';
import * as office from './panels-office';
import * as people from './panels-people';

export const en = { ...office.en, ...people.en, ...help.en } as const satisfies Strings;

export const ar: Arabic<typeof en> = { ...office.ar, ...people.ar, ...help.ar };
