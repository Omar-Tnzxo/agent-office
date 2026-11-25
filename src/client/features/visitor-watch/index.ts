/**
 * Watching a visitor: I at one (standing, walking, or at the desk it sits at), E or a click at one
 * standing, or the palette, opens its Watch window (ui.ts), which the office keeps fed from its
 * transcript for as long as it's open (see server/visitors/watch.ts). E at a seated visitor's desk
 * still hires a worker there: workers come first. One window at a time.
 */
import type { Visitor } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { aside, key } from '../../core/hint';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import type { Interactable } from '../../world/types';
import { openWatchWindow, type WatchView } from './ui';

export type VisitorWatchParts = Pick<Parts, 'pointer' | 'visitors'>;

/** No first look from the office this long after asking: ask once more (the first may have been too soon after another). */
const ASK_AGAIN_MS = 1500;

export function installVisitorWatch(ctx: Ctx, parts: VisitorWatchParts) {
  const { net } = ctx;
  let open: { id: string; view: WatchView; got: boolean; again: number } | null = null;

  const visitor = (id: string): Visitor | undefined => store.visitors.visitors.find((v) => v.id === id);

  /** The visitor at what you're aiming at: one standing or walking, or the one at a desk no worker has. */
  function visitorAt(it: Interactable | null): Visitor | undefined {
    if (it?.kind === 'visitor' && it.seatId) return visitor(it.seatId);
    if (it?.kind === 'desk' && it.deskId && !store.workerAtDesk(it.deskId)) {
      const id = parts.visitors.seatedAt(it.deskId);
      return id ? visitor(id) : undefined;
    }
    return undefined;
  }

  /** Opens `id`'s Watch window (closing any other). */
  function watch(id: string) {
    const v = visitor(id);
    if (!v) return void toast('That visitor has left the office', 'warn');
    if (open?.id === id) return;
    open?.view.close();
    const view = openWatchWindow(v, () => {
      if (open?.id !== id) return;
      clearTimeout(open.again);
      open = null;
      net.send({ t: 'visitor.unwatch', id });
    });
    const again = window.setTimeout(() => {
      if (open?.id === id && !open.got) net.send({ t: 'visitor.watch', id });
    }, ASK_AGAIN_MS);
    open = { id, view, got: false, again };
    net.send({ t: 'visitor.watch', id });
  }

  ctx.messages.on('visitor.feed', (m) => {
    if (open?.id !== m.id) return;
    if (m.reset) open.got = true;
    open.view.feed(m.items, m.agents, !!m.reset);
  });
  ctx.messages.on('visitor.gone', (m) => {
    if (open?.id === m.id) open.view.gone();
  });
  store.on('visitors', () => {
    if (open) open.view.visitor(visitor(open.id));
  });
  // Off to another floor: its window doesn't come along (the office stops sending it, see visitorHooks).
  ctx.messages.on('floor.enter', () => open?.view.close());
  // Back after the connection dropped: the office forgot who you watched, so ask again.
  ctx.messages.on('welcome', () => {
    if (open) net.send({ t: 'visitor.watch', id: open.id });
  });

  ctx.keys.bind({
    code: 'KeyI',
    run: () => {
      const v = visitorAt(parts.pointer.target());
      if (!v) return false;
      watch(v.id);
      return true;
    },
  });

  return {
    watch,
    /** What a desk's hint adds for the visitor sitting at it: who it is, and I to watch it. */
    deskHint(deskId: string): { k: string; parts: HTMLElement[] } {
      const id = parts.visitors.seatedAt(deskId);
      const v = id ? visitor(id) : undefined;
      return v ? { k: `|v:${v.id}`, parts: [aside(`👋 ${v.title} sits here`), key('I', 'Watch')] } : { k: '', parts: [] };
    },
  };
}
