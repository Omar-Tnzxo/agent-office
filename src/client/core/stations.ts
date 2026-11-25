/** The board agents: what each is for, and the ones waiting by their boards before anyone has asked them anything. */
import { STATION_AGENT, type StationKind } from '../../shared/layout';
import { labels, type TextKey } from '../i18n';
import { Worker } from '../world/character';
import type { DeskView } from '../world/types';
import type { World } from '../world/world';
import { noOutline } from './outline';

type StationText = 'offer' | 'about' | 'does' | 'example';

/** A board agent's words, read in the language now each time (see labels), with its board's icon. */
function station(icon: string, keys: Record<StationText, TextKey>): { icon: string } & Record<StationText, string> {
  return Object.assign(labels(keys), { icon });
}

/**
 * What each board agent is for: its board's icon, what it offers on the card over its head (and the
 * same without "Ask me" for the hint bar), and an example ask, shown as the prompt's placeholder only.
 */
export const STATION_INFO: Record<StationKind, { icon: string } & Record<StationText, string>> = {
  issues: station('📌', { offer: 'desks.station.issues.offer', about: 'desks.station.issues.about', does: 'desks.station.issues.does', example: 'desks.station.issues.example' }),
  pulls: station('🔀', { offer: 'desks.station.pulls.offer', about: 'desks.station.pulls.about', does: 'desks.station.pulls.does', example: 'desks.station.pulls.example' }),
  queue: station('📋', { offer: 'desks.station.queue.offer', about: 'desks.station.queue.about', does: 'desks.station.queue.does', example: 'desks.station.queue.example' }),
};

/** A board agent waiting by its board before anyone has asked it anything (see buildKiosk), and where. */
export interface IdleAgent {
  model: Worker;
  view: DeskView;
}

/** The board agents waiting by their boards in `w`. */
export function idleAgentsIn(w: World): IdleAgent[] {
  return w.plan.stations.map((def) => {
    const kind = def.station!;
    const agent = STATION_AGENT[kind];
    const model = new Worker(agent.name, agent.color);
    model.setStatus('idle', false);
    model.setTask({ name: STATION_INFO[kind].offer, summary: STATION_INFO[kind].does });
    model.setOutfit(w.plan.agents.outfit === 'peasant' ? 'peasant' : null);
    const view = w.desks.get(def.id)!;
    view.vacancy.children[0].add(model.root);
    noOutline(model.root);
    return { model, view };
  });
}
