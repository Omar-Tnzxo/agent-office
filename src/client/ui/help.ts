// The rows of the controls help (openHelp in hud.ts), in the order it shows them: a key or an emoji, and
// what it does. A new control is a new row here, with its words in i18n/strings/panels-help.ts.

import { t, type TextKey } from '../i18n';
import { IS_MAC } from './termkeys';

/**
 * A row whose words are read in the language now each time: `key` is a key cap or emoji as written,
 * or a phrase key when the cap is a word ("Mouse").
 */
function row(key: string | { word: TextKey }, text: TextKey): readonly [string, string] {
  const r = ['', ''] as [string, string];
  Object.defineProperty(r, 0, { get: () => (typeof key === 'string' ? key : t(key.word)), enumerable: true });
  Object.defineProperty(r, 1, { get: () => t(text), enumerable: true });
  return r;
}

export const HELP_ROWS: readonly (readonly [string, string])[] = [
  row('W A S D', 'panels.help.walk'),
  row('Space', 'panels.help.jump'),
  row('☕', 'panels.help.coffee'),
  row({ word: 'panels.help.key.mouse' }, 'panels.help.mouse'),
  row({ word: 'panels.help.key.click' }, 'panels.help.use'),
  row('👥', 'panels.help.people'),
  row('🛗', 'panels.help.elevator'),
  row('🤖', 'panels.help.agents'),
  row('📝', 'panels.help.whiteboard'),
  row('🕹️', 'panels.help.arcade'),
  row('🎉', 'panels.help.gong'),
  row('N', 'panels.help.next'),
  row('🏀', 'panels.help.hoop'),
  row('🏎️', 'panels.help.cars'),
  row('🍸', 'panels.help.roof'),
  row('🎯', 'panels.help.darts'),
  row({ word: 'panels.help.key.drag' }, 'panels.help.orbit'),
  row('P', 'panels.help.prompt'),
  row('C', 'panels.help.changes'),
  row('B', 'panels.help.shell'),
  row('R', 'panels.help.resume'),
  row('X', 'panels.help.home'),
  row('L', 'panels.help.sign'),
  row('🚧', 'panels.help.grow'),
  row('F', 'panels.help.picture'),
  row('Q', 'panels.help.putBack'),
  row('🐶', 'panels.help.dog'),
  row('O', 'panels.help.pr'),
  row('T', 'panels.help.chat'),
  row('G / 1-6', 'panels.help.emote'),
  row('/', 'panels.help.search'),
  row(IS_MAC ? '⌘K' : 'Ctrl+K', 'panels.help.palette'),
  row('V', 'panels.help.voice'),
  row('M', 'panels.help.mute'),
  row('Ctrl+Space', 'panels.help.dictate'),
  row('Tab', 'panels.help.tab'),
  row('Esc', 'panels.help.esc'),
  row('Ctrl + [', 'panels.help.ctrlEsc'),
  row('⚙️', 'panels.help.settings'),
];
