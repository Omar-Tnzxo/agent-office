/**
 * The HUD: a few buttons on the top bar, everything else in the ☰ menu (Tab), with H for the controls
 * and F to hang a picture; the project in the corner (click it for the floors); Settings, and your
 * character.
 */
import { ROOF } from '../../../shared/rooftop';
import type { Ctx } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import { builtFloors } from '../../core/floors';
import type { Parts } from '../../core/parts';
import { waitingInOrder, waitingLabel } from '../../nextup';
import { saveSettings, store } from '../../state';
import { openAccounts } from '../../ui/accounts';
import { openBoard } from '../../ui/boards';
import { openCharacter } from '../../ui/character';
import { $ } from '../../ui/dom';
import { toggleFloorMenu } from '../../ui/floormenu';
import { openHelp } from '../../ui/hud';
import { mountHud } from '../../ui/menu';
import { openServices } from '../../ui/services';
import { openSettings, type SettingsPane } from '../../ui/settings';
import { needsSigningIn, openSignIns } from '../../ui/signins';
import { openTeam } from '../../ui/team';
import { openUpgrade } from '../../ui/upgrade';
import { openWhiteboard } from '../whiteboard/ui';
import { describeSky } from '../../world/sky';
import { t, type TextKey } from '../../i18n';

export type HudParts = Pick<Parts, 'worlds' | 'place' | 'travel' | 'you' | 'actions' | 'waiting' | 'meeting' | 'bookshelf' | 'handoffs' | 'hanging' | 'talk' | 'notifier'>;

/** Listens for clicks on the HUD and the project, registers what the HUD follows (see mountHud), and binds Tab, H and F. */
export function installHud(ctx: Ctx, core: CoreState, parts: HudParts) {
  const { net, voice, settings, player, sound } = ctx;
  const { inOffice } = parts.worlds;
  const { travel, waiting, actions, hanging, talk } = parts;

  // Buttons must not keep focus, or Space (jump) would click them again.
  $('hud').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (btn) setTimeout(() => btn.blur(), 0);
  });
  // The project in the corner is the floor you're on; click it for the list of floors to go to.
  $('project').addEventListener('click', () => {
    if (!store.floor) return travel.showElevator();
    toggleFloorMenu($('project'), { go: travel.switchFloor, indoors: () => (!inOffice() && !core.upTop) || parts.place.indoors(), elevator: travel.showElevator, roof: inOffice() ? () => travel.ride(ROOF) : null });
  });

  // ---- The HUD: a few buttons on the top bar, everything else in the ☰ menu ----------------------------
  const waitingNow = () => waitingInOrder(store.workers.values());
  const noMedia = () => (window.isSecureContext ? undefined : t('hud.act.noMedia'));
  // Labels and titles are read each time they're drawn, so a switch of language shows at once.
  const say = (key: TextKey) => () => t(key);
  const hud = mountHud(
    [
      { id: 'issues', icon: '📌', label: say('hud.act.issues'), section: 'Open', count: () => store.issues.items.filter((i) => i.state === 'OPEN').length, run: () => openBoard('issues', net, actions.boardActions()) },
      { id: 'pulls', icon: '🔀', label: say('hud.act.pulls'), section: 'Open', count: () => store.pulls.items.filter((p) => p.state === 'OPEN').length, run: () => openBoard('pulls', net, actions.boardActions()) },
      { id: 'queue', icon: '📋', label: say('hud.act.queue'), section: 'Open', count: () => store.queue.tasks.filter((t) => t.status !== 'done').length, title: say('hud.act.queue.title'), run: waiting.showQueue },
      { id: 'services', icon: '🌐', label: say('hud.act.services'), section: 'Open', count: () => store.services.items.length, title: say('hud.act.services.title'), run: () => openServices() },
      { id: 'whiteboard', icon: '📝', label: say('hud.act.whiteboard'), section: 'Open', title: say('hud.act.whiteboard.title'), run: () => openWhiteboard(net) },
      // Up on the top bar while a meeting is on: what's being worked through in the meeting room.
      {
        id: 'meeting',
        icon: '🤝',
        label: say('hud.act.meeting'),
        section: 'Open',
        status: () => store.meeting.current?.status === 'running',
        chip: say('hud.act.meeting.chip'),
        title: say('hud.act.meeting.title'),
        run: () => parts.meeting.showMeeting(),
      },
      { id: 'search', icon: '🔎', label: say('hud.act.search'), section: 'Open', key: '/', title: say('hud.act.search.title'), run: waiting.showSearch },
      // The office has its bookshelf for them; a map of its own may not.
      { id: 'docs', icon: '📚', label: say('hud.act.docs'), section: 'Open', shown: () => !inOffice(), title: say('hud.act.docs.title'), run: parts.bookshelf.showBookshelf },
      { id: 'review', icon: '🗂️', label: say('tickets.name'), section: 'Open', shown: () => store.tickets.on && store.me.admin, count: () => store.tickets.approvals.length, title: say('tickets.menuTitle'), run: () => parts.handoffs.showReview() },
      { id: 'elevator', icon: '🛗', label: () => t(inOffice() ? 'hud.act.elevator' : 'hud.act.floors'), section: 'Open', count: () => store.floors.reduce((n, f) => n + (f.id === store.floor ? 0 : f.waiting), 0), title: () => t(inOffice() ? 'hud.act.elevator.title' : 'hud.act.floors.title'), run: travel.showElevator },
      { id: 'roof', icon: '🍸', label: say('hud.act.roof'), section: 'Open', shown: () => !core.upTop && inOffice() && builtFloors().length > 0, title: say('hud.act.roof.title'), run: () => travel.ride(ROOF) },
      // In voice, V is push to talk, so leaving is only from here.
      { id: 'voice', icon: '🎙️', label: () => t(voice.inVoice ? 'hud.act.leaveVoice' : 'hud.act.joinVoice'), section: 'Together', key: () => (voice.inVoice ? undefined : 'V'), on: () => voice.inVoice, blocked: noMedia, run: () => void talk.toggleVoice() },
      // While you're in voice, the top bar keeps the mute button handy. Muted is the usual with push to talk, so it doesn't stand out then.
      {
        id: 'mute',
        icon: () => (voice.muted ? '🔇' : '🎙️'),
        label: () => t(voice.muted ? 'hud.act.unmute' : 'hud.act.mute'),
        section: 'Together',
        key: 'M',
        shown: () => voice.inVoice,
        status: () => voice.inVoice,
        on: () => voice.inVoice,
        tone: () => (voice.muted && !settings.pushToTalk ? 'danger' : undefined),
        title: () => t(voice.muted ? 'hud.act.muted.title' : 'hud.act.mute.title'),
        run: () => voice.toggleMute(),
      },
      { id: 'share', icon: '🖥️', label: () => t(voice.sharing ? 'hud.act.stopShare' : 'hud.act.share'), section: 'Together', on: () => voice.sharing, status: () => voice.sharing, chip: say('hud.act.sharing'), blocked: noMedia, run: () => void talk.toggleShare() },
      { id: 'decor', icon: '🖼️', label: () => t(hanging.hanger.active ? 'hud.act.stopHang' : 'hud.act.hang'), section: 'Together', key: 'F', shown: () => inOffice(), on: () => hanging.hanger.active, status: () => hanging.hanger.active, run: () => (hanging.hanger.active ? hanging.hanger.cancel() : hanging.startHanging()) },
      { id: 'team', icon: '👥', label: say('hud.act.team'), section: 'Together', shown: () => store.invites, run: () => openTeam(net) },
      { id: 'accounts', icon: '🔑', label: say('hud.act.accounts'), section: 'Together', shown: () => store.me.admin, title: say('hud.act.accounts.title'), run: () => openAccounts(net) },
      { id: 'signins', icon: '🔐', label: say('hud.act.signins'), section: 'Together', shown: () => !!store.me.account, tone: () => (needsSigningIn() ? 'danger' : undefined), status: needsSigningIn, chip: say('hud.act.signins.chip'), title: say('hud.act.signins.title'), run: () => openSignIns(net) },
      { id: 'settings', icon: '⚙️', label: say('hud.act.settings'), section: 'Office', run: showSettings },
      { id: 'help', icon: '❓', label: say('hud.act.help'), section: 'Office', key: 'H', run: openHelp },
      { id: 'lite', icon: '📱', label: say('hud.act.lite'), section: 'Office', title: say('hud.act.lite.title'), run: () => location.assign('/lite') },
      {
        id: 'upgrade',
        icon: '⬆️',
        label: () => t(store.upgrade.phase === 'building' ? 'hud.act.upgrading' : store.upgrade.latest ? 'hud.act.update' : 'hud.act.upgrade'),
        section: 'Office',
        shown: () => store.upgrade.available,
        // A new version, or one being built, gets a place on the top bar until it's in.
        status: () => !!store.upgrade.latest || store.upgrade.phase === 'building',
        chip: () => t(store.upgrade.phase === 'building' ? 'hud.act.upgrading' : 'hud.act.update.chip'),
        tone: () => (store.upgrade.latest && store.upgrade.phase !== 'building' ? 'primary' : undefined),
        title: () => (store.upgrade.latest ? t('hud.act.newVersion', { subject: store.upgrade.latest.subject }) : t('hud.act.upgrade')),
        run: () => openUpgrade(net),
      },
      // Up on the top bar while workers wait on someone (N does the same), next to the Workers button.
      {
        id: 'waiting',
        icon: () => (waitingNow().some((w) => w.status === 'needs_input') ? '🙋' : '✅'),
        label: say('hud.act.next'),
        section: 'Open',
        key: 'N',
        shown: () => waitingNow().length > 0,
        status: () => waitingNow().length > 0,
        chip: () => waitingLabel(waitingNow()).replace(/^(🙋|✅) /, ''),
        on: () => waitingNow().every((w) => w.status === 'done'),
        tone: () => (waitingNow().some((w) => w.status === 'needs_input') ? 'danger' : undefined),
        title: say('hud.waitingTitle'),
        run: waiting.goToNextWaiting,
      },
    ],
    settings,
    () => saveSettings(settings),
  );
  ctx.keys.bind({
    code: 'Tab',
    preventDefault: true,
    run: () => {
      hud.toggleMenu();
    },
  });
  ctx.keys.bind({
    code: 'KeyH',
    run: () => {
      openHelp();
    },
  });
  ctx.keys.bind({
    code: 'KeyF',
    run: () => {
      hanging.startHanging();
    },
  });
  function showSettings(pane?: SettingsPane) {
    openSettings(
      net,
      settings,
      (s) => {
        // Switching to push to talk mutes you now; back to an open mic turns it on.
        const talkChanged = s.pushToTalk !== settings.pushToTalk;
        Object.assign(settings, s);
        saveSettings(settings);
        if (talkChanged) {
          voice.setMuted(settings.pushToTalk);
          hud.refresh();
        }
        player.setView(settings.view);
        sound.setVolume(settings.volume, settings.muted);
        sound.setMusicVolume(settings.music, settings.musicMuted);
      },
      editProfile,
      sound,
      parts.notifier,
      signOut,
      store.sky ? { now: describeSky(store.sky, store.officeNow()), live: !!store.sky.city } : undefined,
      pane,
    );
  }

  async function signOut() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  }

  function editProfile() {
    openCharacter(false, (p) => {
      parts.you.showMyProfile(p);
      net.send({ t: 'profile', name: p.name, color: p.color, look: p.look });
    });
  }

  return { hud, showSettings, editProfile };
}
