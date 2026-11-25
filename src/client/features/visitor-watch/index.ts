/**
 * Watching a visitor: I at one (standing, walking, or at the desk it sits at), E or a click at one
 * standing, or the palette, opens its Watch window (ui.ts), which the office keeps fed from its
 * transcript for as long as it's open (see server/visitors/watch.ts). E at a seated visitor's desk
 * still hires a worker there: workers come first. One window at a time, and admins only (a
 * transcript holds whatever its session read): nobody else is offered it, and the office turns
 * anyone else away. Its laptop is for everyone on the floor.
 */
import type { Visitor } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { aside, key } from '../../core/hint';
import type { Parts } from '../../core/parts';
import { onLang, t } from '../../i18n';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import type { Interactable } from '../../world/types';
import { openWatchWindow, type WatchView } from './ui';

export type VisitorWatchParts = Pick<Parts, 'pointer' | 'visitors'>;

/** No first look from the office this long after asking: ask again (it turns away opens that come too fast), a few times. */
const ASK_AGAIN_MS = 1500;
const ASKS = 6;

/** Whether you may watch visitors: admins only (the office checks again). */
export const canWatch = (): boolean => store.me.admin;

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

  /** Asks the office for `id`'s feed, and again every so often until it answers. */
  function ask(id: string) {
    if (!open || open.id !== id) return;
    clearInterval(open.again);
    let tries = 1;
    net.send({ t: 'visitor.watch', id });
    const timer = window.setInterval(() => {
      if (open?.id !== id || open.got || tries >= ASKS) return clearInterval(timer);
      tries++;
      net.send({ t: 'visitor.watch', id });
    }, ASK_AGAIN_MS);
    open.again = timer;
  }

  /** Opens `id`'s Watch window (closing any other). */
  function watch(id: string) {
    if (!canWatch()) return;
    const v = visitor(id);
    if (!v) return void toast(t('watch.gone'), 'warn');
    if (open?.id === id) return;
    open?.view.close();
    const view = openWatchWindow(v, () => {
      if (open?.id !== id) return;
      clearInterval(open.again);
      open = null;
      net.send({ t: 'visitor.unwatch', id });
    });
    open = { id, view, got: false, again: 0 };
    ask(id);
  }

  ctx.messages.on('visitor.feed', (m) => {
    if (open?.id !== m.id) return;
    if (m.reset) open.got = true;
    open.view.feed(m.items, m.agents, !!m.reset);
  });
  ctx.messages.on('visitor.gone', (m) => {
    if (open?.id !== m.id) return;
    open.got = true;
    open.view.gone();
  });
  store.on('visitors', () => {
    if (open) open.view.visitor(visitor(open.id));
  });
  // No longer an admin: the window goes.
  store.on('me', () => {
    if (open && !canWatch()) open.view.close();
  });
  // Off to another floor: its window doesn't come along (the office stops sending it, see visitorHooks).
  ctx.messages.on('floor.enter', () => open?.view.close());
  // A switch of language: the window's own words now, and what's in it again from the office (its
  // labels were drawn in the other language), the way it comes when the window opens.
  onLang(() => {
    if (!open) return;
    open.view.relabel();
    net.send({ t: 'visitor.unwatch', id: open.id });
    open.got = false;
    ask(open.id);
  });
  // Back after the connection dropped: the office forgot who you watched, so ask again.
  ctx.messages.on('welcome', () => {
    if (!open) return;
    open.got = false;
    ask(open.id);
  });

  ctx.keys.bind({
    code: 'KeyI',
    run: () => {
      const v = canWatch() ? visitorAt(parts.pointer.target()) : undefined;
      if (!v) return false;
      watch(v.id);
      return true;
    },
  });

  return {
    watch,
    /** What a desk's hint adds for the visitor sitting at it: who it is, and I to watch it (for an admin). */
    deskHint(deskId: string): { k: string; parts: HTMLElement[] } {
      const id = parts.visitors.seatedAt(deskId);
      const v = id ? visitor(id) : undefined;
      if (!v) return { k: '', parts: [] };
      const admin = canWatch();
      return { k: `|v:${v.id}:${admin}`, parts: [aside(t('watch.sitsHere', { title: v.title })), admin ? key('I', t('watch.key')) : ''].filter((p): p is HTMLElement => !!p) };
    },
  };
}
