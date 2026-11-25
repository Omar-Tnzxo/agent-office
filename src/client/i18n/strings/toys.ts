// Phrases for the things to do in the office: arcade, bar, games, the dog, golf, cars, the rooftop....
// The area is split over files to stay under the size budget: toys-games.ts and toys-places.ts hold
// its parts, merged here.
// How to add a phrase: see ../index.ts.
import type { Arabic, Strings } from '../types';
import * as games from './toys-games';
import * as places from './toys-places';

export const en = { ...games.en, ...places.en } as const satisfies Strings;

export const ar: Arabic<typeof en> = { ...games.ar, ...places.ar };
