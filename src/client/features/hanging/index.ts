/**
 * Hanging a picture on a wall of this floor (F), moving one, and looking closer at one hung already.
 * The pictures themselves are the gallery's (see gallery.ts).
 */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { Hanger } from './controller';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import { t } from '../../i18n';
import type { Gallery } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    decor: true;
  }
}

export { installGallery } from './gallery';

export interface HangingDeps {
  /** The pictures on the walls (see installGallery). */
  gallery: Gallery;
  /** Plays the reach on your hands and your character, and shows it to everyone else. */
  reach(): void;
}

export function installHanging(ctx: Ctx, deps: HangingDeps) {
  const hanger = new Hanger(ctx.net, ctx.camera, ctx.canvas, ctx.player, ctx.office, deps.gallery);
  ctx.scene.add(hanger.ghost.group);
  hanger.onChange = () => {
    ctx.hud.refresh();
    ctx.hint.invalidate();
  };
  ctx.activities.add({
    id: 'hanger',
    active: () => hanger.active,
    // Put away for anything but walking over to someone, which you can do holding a picture up.
    stop: (why) => {
      if (why !== 'walk') hanger.cancel();
    },
    key: (e) => {
      if (!hangingKey(e.code)) return false;
      e.preventDefault();
      return true;
    },
    hint: (el) => renderHangHint(el),
  });
  ctx.ticks.add('world', () => hanger.update());
  ctx.interactions.define('decor', {
    reach: 9,
    hint: (it) => {
      const d = store.decor.find((x) => x.id === it.decorId);
      return { k: `${d?.title}|${d?.by}`, parts: [hintTitle(`🖼️ ${d?.title || t('toys.hang.aPicture')}`), d ? aside(t('toys.hang.hungBy', { name: d.by })) : '', key('E', t('toys.hang.lookCloser'))] };
    },
    use: onE((it) => {
      if (it.decorId) hanger.view(it.decorId);
    }),
  });

  /** Keys while hanging a picture. Walking, chat and voice work as usual. */
  function hangingKey(code: string): boolean {
    switch (code) {
      case 'Escape':
      case 'KeyF':
        hanger.cancel();
        return true;
      case 'KeyE':
      case 'Enter':
        deps.reach();
        hanger.place();
        return true;
      case 'BracketLeft':
      case 'Minus':
        hanger.resize(-1);
        return true;
      case 'BracketRight':
      case 'Equal':
        hanger.resize(1);
        return true;
    }
    return false;
  }

  function renderHangHint(el: HTMLElement) {
    const spot = hanger.spot;
    ctx.hint.draw(el, `hang|${hanger.moving}|${spot ? spot.ok : '-'}`, () => {
      const title = t(!spot ? 'toys.hang.aimWall' : !spot.ok ? 'toys.hang.inTheWay' : hanger.moving ? 'toys.hang.moving' : 'toys.hang.hanging');
      return [h('span.title', {}, title), key(t('toys.key.click'), t('toys.hang.hang')), key(t('toys.key.scroll'), t('toys.hang.size')), key('Esc', t('common.cancel'))];
    });
  }

  /** F: hang a picture on a wall of this floor. There are no walls for them up on the roof. */
  function startHanging() {
    if (ctx.upTop()) return toast(t('toys.hang.noWalls'), 'warn');
    if (!ctx.inOffice()) return toast(`${ctx.plan().icon} ${t('toys.hang.mapWalls', { map: ctx.plan().name })}`, 'warn');
    hanger.start();
  }

  return { hanger, startHanging };
}
