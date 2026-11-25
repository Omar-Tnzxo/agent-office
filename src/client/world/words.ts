import { t, type TextKey } from '../i18n';

// The boards' names as the maps give them (shared/layout.ts, shared/maps): in English, since the
// server and a map of your own share them. The built-in ones are read in the viewer's language over
// the boards; a name someone gave their own map's board is shown as they wrote it.
const BOARD_PHRASE: Readonly<Record<string, TextKey>> = {
  Issues: 'world.board.issues',
  '📋 Task queue': 'world.board.queue',
  'Pull Requests': 'world.board.pulls',
  '🌐 Services': 'world.board.services',
  '📜 Petitions': 'world.board.petitions',
  '📋 Orders of the day': 'world.board.orders',
  '🔀 Decrees for the seal': 'world.board.decrees',
  '📡 Incoming signals': 'world.board.signals',
  '📋 Mission queue': 'world.board.missions',
  '🔀 Docking requests': 'world.board.docking',
  '🌐 Subsystems': 'world.board.subsystems',
};

/** What reads a board's name over it (for phrasePlane): its phrase when it's a built-in one, else the name itself. */
export function boardWords(label: string): () => string {
  const key = Object.hasOwn(BOARD_PHRASE, label) ? BOARD_PHRASE[label] : undefined;
  return key ? () => t(key) : () => label;
}
