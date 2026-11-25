/**
 * Every area's phrases in one English table and one Arabic table. An area is a file in `strings/`
 * with its `en` and its `ar`; its keys start with its name, and tests/i18n.test.ts checks no two
 * areas share a key (a later area would quietly win). A new area goes in AREAS.
 */
import * as character from './strings/character';
import * as common from './strings/common';
import * as desks from './strings/desks';
import * as github from './strings/github';
import * as hire from './strings/hire';
import * as hud from './strings/hud';
import * as login from './strings/login';
import * as pages from './strings/pages';
import * as panels from './strings/panels';
import * as server from './strings/server';
import * as settings from './strings/settings';
import * as tickets from './strings/tickets';
import * as toys from './strings/toys';
import * as watch from './strings/watch';
import * as work from './strings/work';
import * as world from './strings/world';

/** Each area by name, for the tests. */
export const AREAS = { character, common, desks, github, hire, hud, login, pages, panels, server, settings, tickets, toys, watch, work, world };

export const EN = {
  ...common.en,
  ...login.en,
  ...character.en,
  ...settings.en,
  ...hud.en,
  ...github.en,
  ...work.en,
  ...hire.en,
  ...panels.en,
  ...desks.en,
  ...toys.en,
  ...world.en,
  ...server.en,
  ...pages.en,
  ...watch.en,
  ...tickets.en,
};

export const AR = {
  ...common.ar,
  ...login.ar,
  ...character.ar,
  ...settings.ar,
  ...hud.ar,
  ...github.ar,
  ...work.ar,
  ...hire.ar,
  ...panels.ar,
  ...desks.ar,
  ...toys.ar,
  ...world.ar,
  ...server.ar,
  ...pages.ar,
  ...watch.ar,
  ...tickets.ar,
};

export type Key = keyof typeof EN;
/** The keys of plain phrases, for `t`. */
export type TextKey = { [K in Key]: (typeof EN)[K] extends string ? K : never }[Key];
/** The keys of phrases that change with a count, for `tn`. */
export type PluralKey = Exclude<Key, TextKey>;
