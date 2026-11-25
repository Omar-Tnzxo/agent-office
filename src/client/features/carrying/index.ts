/**
 * Carrying an issue card: off the issues board (or its window's ✋) into your hands, and E with it at
 * an empty desk, a worker, the queue, the meeting room or the herald hands it over; Q puts it back.
 * Which card you hold is the office's (ctx.carrying), since so much else looks at it.
 */
import type { AgentEffort, AgentProvider, CarriedIssue, GhIssue, WorkerInfo } from '../../../shared/protocol';
import { isAsleep } from '../../../shared/status';
import type { Ctx, Hint } from '../../core/context';
import { aside, key } from '../../core/hint';
import { store } from '../../state';
import { issuePrompt } from '../../ui/github/prompts';
import { closeAllModals, h, toast } from '../../ui/dom';
import { t } from '../../i18n';
import { issueMeeting, type MeetingPreset } from '../../ui/meeting';
import { worktreePref } from '../../ui/prompt';
import { officeChoice } from '../../ui/provider';
import { hiringPaused } from '../../ui/usage';
import type { Interactable } from '../../world/types';

export interface CarryingDeps {
  /** Puts `card` in your hands, or none: what ctx.carrying says from then on. */
  hold(card: CarriedIssue | null): void;
  /** The issues board, which leaves off the cards someone's carrying around (see features/boards). */
  boards: { cardMoved(): void };
  /** The note on the issues board you're pointing at, if any (see aimedNote in input/pointer.ts). */
  aimedNote(): GhIssue | null;
  /** Plays the reach on your hands and your character, and shows it to everyone else. */
  reach(): void;
  /** Drops the ball, if it's in your hands (see features/basketball). */
  dropBall(): void;
  /** Hires a worker at `deskId` (see hire in features/workers/actions.ts). */
  hire(deskId: string, prompt?: string, worktree?: boolean, provider?: AgentProvider, model?: string, effort?: AgentEffort, issue?: number, repos?: string[], via?: 'herald'): void;
  /** The seat the herald sends a new worker to (see heraldSeat in features/workers/views.ts). */
  heraldSeat(): string | undefined;
  /** Seats you've just sent a worker out to from the herald, so a second goes elsewhere. */
  heraldHires: Map<string, { floor: string | null; at: number }>;
  /** The office is at its worker limit: says so, and says yes. */
  officeIsFull(): boolean;
  /** The meeting room's window, prefilled with `preset`. */
  showMeeting(preset?: MeetingPreset): void;
}

export function installCarrying(ctx: Ctx, deps: CarryingDeps) {
  function setCarrying(card: CarriedIssue | null) {
    if ((card?.issue ?? 0) === (ctx.carrying()?.issue ?? 0)) return;
    deps.hold(card);
    ctx.me.carry(card);
    ctx.hands.carry(card);
    ctx.net.send({ t: 'carry', issue: card?.issue, title: card?.title });
    deps.boards.cardMoved();
    ctx.hint.invalidate();
  }

  /** ✋ in an issue's window, or E at its note on the board: its card comes off the board and into your hands. */
  function pickUp(it: GhIssue) {
    closeAllModals();
    deps.dropBall();
    const carrying = ctx.carrying();
    if (carrying?.issue === it.number) return;
    if (carrying) toast(t('toys.card.wentBack', { n: `#${carrying.issue}` }));
    setCarrying({ issue: it.number, title: it.title });
    ctx.sound.paper();
    toast(t('toys.card.took', { n: `#${it.number}` }));
  }

  /** Q, or E at the issues board: the card goes back where it came from. */
  function putBack() {
    const carrying = ctx.carrying();
    if (!carrying) return;
    toast(t('toys.card.isBack', { n: `#${carrying.issue}` }));
    setCarrying(null);
    ctx.sound.paper();
  }
  ctx.keys.bind({
    code: 'KeyQ',
    when: () => !!ctx.carrying(),
    run: () => {
      deps.reach();
      putBack();
    },
  });

  /**
   * E with a card in your hands: an empty desk hires a worker for the issue (with the prompt 🤖 Hand
   * to a worker uses), an agent at a desk gets it as its next prompt, the queue board queues it, and
   * the issues board takes it back (or swaps it for the `note` you point at there). False when it's none
   * of those, so E does what it always does there.
   */
  function dropCard(it: Interactable, card: CarriedIssue, note: GhIssue | null): boolean {
    if (it.kind === 'issues') {
      if (note) pickUp(note);
      else putBack();
      return true;
    }
    const prompt = issuePrompt({ number: card.issue, title: card.title });
    if (it.kind === 'queue') {
      if (onQueue(card.issue)) toast(t('toys.card.onQueueAlready', { n: `#${card.issue}` }), 'warn');
      else {
        const { provider, model, effort } = officeChoice(store.project);
        ctx.net.send({ t: 'queue.add', prompt, title: `#${card.issue} ${card.title}`, issue: card.issue, provider, model, effort });
        putDown();
      }
      return true;
    }
    // At the meeting room: a meeting about it, and the card goes back up on the board.
    if (it.kind === 'meeting' || (it.kind === 'desk' && it.deskId && ctx.plan().byId.get(it.deskId)?.room && !store.workerAtDesk(it.deskId))) {
      putBack();
      deps.showMeeting(issueMeeting(card.issue, card.title));
      return true;
    }
    // To the herald: someone's sent out for it, to the first free seat.
    if (it.kind === 'herald') {
      const deskId = deps.heraldSeat();
      if (!deskId) toast(t('toys.seatsTaken'), 'warn');
      else if (hiringPaused()) toast(t('toys.budgetSpent'), 'warn');
      else if (!deps.officeIsFull()) {
        const { provider, model, effort } = officeChoice(store.project);
        deps.heraldHires.set(deskId, { floor: store.floor, at: performance.now() });
        deps.hire(deskId, prompt, !!store.project?.branch && worktreePref(), provider, model, effort, card.issue, undefined, 'herald');
        putDown();
      }
      return true;
    }
    if (it.kind !== 'desk' || !it.deskId) return false;
    const w = store.workerAtDesk(it.deskId);
    const why = w ? cantTakeCard(w) : hiringPaused() ? t('toys.budgetSpent') : '';
    if (why) toast(why, 'warn');
    else if (w) {
      ctx.net.send({ t: 'worker.prompt', workerId: w.id, prompt, issue: card.issue });
      putDown();
    } else if (!deps.officeIsFull()) {
      const { provider, model, effort } = officeChoice(store.project);
      deps.hire(it.deskId, prompt, !!store.project?.branch && worktreePref(), provider, model, effort, card.issue);
      putDown();
    }
    return true;
  }

  /** The card left your hands for a desk or the queue (the office says who took it). */
  function putDown() {
    setCarrying(null);
    ctx.sound.paper();
  }

  function onQueue(issue: number): boolean {
    const task = store.taskForIssue(issue);
    return !!task && task.status !== 'done';
  }

  /** Why the worker at a desk can't be handed an issue card right now, or '' when it can. */
  function cantTakeCard(w: WorkerInfo): string {
    if (w.kind === 'shell') return t('toys.card.shell', { name: w.name });
    if (w.lost) return t('toys.card.lost', { name: w.name });
    if (isAsleep(w.status)) return t('toys.card.asleep', { name: w.name });
    if (w.status === 'needs_input') return t('toys.card.waiting', { name: w.name });
    return '';
  }

  /** With an issue card in your hands: what E does with it here, and how to put it back. */
  function carryHint(card: CarriedIssue, it: Interactable | null): Hint {
    const parts = (...mid: (HTMLElement | string)[]) => [h('span.title', {}, t('toys.card.inHand', { n: `#${card.issue}` })), ...mid, key('Q', t('toys.card.putBack'))];
    const aimedNote = deps.aimedNote();
    if (it?.kind === 'issues') return aimedNote ? { k: String(aimedNote.number), parts: parts(key('E', t('toys.card.swap', { n: `#${aimedNote.number}` }))) } : { k: '', parts: parts(key('E', t('toys.card.pinBack'))) };
    if (it?.kind === 'ball') return { k: 'ball', parts: parts(aside(t('toys.card.handsFull'))) };
    if (it?.kind === 'queue') {
      const on = onQueue(card.issue);
      return { k: String(on), parts: parts(on ? aside(t('toys.card.onQueue')) : key('E', t('toys.card.toQueue'))) };
    }
    if (it?.kind === 'herald') {
      const paused = hiringPaused();
      return { k: `herald|${paused}`, parts: parts(paused ? h('span.cost', {}, t('toys.budgetSpent')) : key('E', t('toys.card.sendOut'))) };
    }
    if (it?.kind === 'meeting' || (it?.kind === 'desk' && it.deskId && ctx.plan().byId.get(it.deskId)?.room && !store.workerAtDesk(it.deskId))) {
      return { k: 'meeting', parts: parts(key('E', t('toys.card.meeting'))) };
    }
    if (it?.kind === 'desk' && it.deskId) {
      const w = store.workerAtDesk(it.deskId);
      if (!w) {
        const paused = hiringPaused();
        return { k: String(paused), parts: parts(paused ? h('span.cost', {}, t('toys.budgetSpent')) : key('E', t('toys.card.hire'))) };
      }
      const why = cantTakeCard(w);
      return { k: w.id + w.status + why, parts: parts(why ? aside(why) : key('E', t('toys.card.handTo', { name: w.name }))) };
    }
    // Anything else works as usual, card in hand.
    if (it) {
      const rest = ctx.interactions.hint(it);
      return { k: rest.k, parts: parts(...rest.parts) };
    }
    return { k: '', parts: parts(aside(t('toys.card.takeIt'))) };
  }

  return { setCarrying, pickUp, dropCard, carryHint };
}
