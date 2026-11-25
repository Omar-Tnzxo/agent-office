/**
 * The office TV: the screen someone on the floor is sharing, or its idle card while nobody is. What's
 * shared, and watching it full screen, is features/voice's.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { hintTitle, key, onE } from '../../core/hint';
import { onLang, t } from '../../i18n';
import { dirFor, FONT } from '../../i18n/canvas';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    tv: true;
  }
}

export interface TvDeps {
  /** The screens shared on this floor, by who's sharing them (see features/voice). */
  shares(): [string, MediaStream][];
  /** Watches what's on the TV full screen, or shares your screen when nobody's sharing (see features/voice). */
  watch(): void;
}

export function installTv(ctx: Ctx, deps: TvDeps) {
  // TV
  const tvVideo = document.createElement('video');
  tvVideo.muted = true;
  tvVideo.playsInline = true;
  tvVideo.autoplay = true;
  const tvTexture = new THREE.VideoTexture(tvVideo);
  tvTexture.colorSpace = THREE.SRGBColorSpace;
  const idleCanvas = document.createElement('canvas');
  idleCanvas.width = 1280;
  idleCanvas.height = 720;
  const tvIdle = new THREE.CanvasTexture(idleCanvas);
  tvIdle.colorSpace = THREE.SRGBColorSpace;
  /** The idle card, in the language now (drawn again on a switch). */
  function paintIdle() {
    const g = idleCanvas.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 1280, 720);
    grad.addColorStop(0, '#3a0ca3');
    grad.addColorStop(1, '#4cc9f0');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1280, 720);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    const title = t('desks.tv.title');
    const sub = t('desks.tv.idle');
    g.font = `900 88px ${FONT}`;
    dirFor(g, title);
    g.fillText(title, 640, 330);
    g.font = `700 44px ${FONT}`;
    dirFor(g, sub);
    g.fillText(sub, 640, 420);
    tvIdle.needsUpdate = true;
  }
  paintIdle();
  onLang(paintIdle);
  const tvMat = ctx.office.tvScreen.material as THREE.MeshBasicMaterial;
  tvMat.color.set('#ffffff');
  tvMat.map = tvIdle;
  tvMat.toneMapped = false;
  ctx.interactions.define('tv', {
    reach: 10,
    hint: () => {
      const any = deps.shares().length > 0;
      return { k: String(any), parts: [hintTitle(t('desks.tv.title')), key('E', t(any ? 'desks.tv.watch' : 'desks.tv.share'))] };
    },
    use: onE(() => deps.watch()),
  });

  let tvStream: MediaStream | null = null;
  /** Puts `stream` up on the TV, or the idle card when there's none. */
  function show(stream: MediaStream | null) {
    if (stream !== tvStream) {
      tvStream = stream;
      tvVideo.srcObject = stream;
      if (stream) void tvVideo.play().catch(() => {});
      tvMat.map = stream ? tvTexture : tvIdle;
      tvMat.needsUpdate = true;
    }
  }

  return { show };
}
