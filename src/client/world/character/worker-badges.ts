import type * as THREE from 'three';
import type { WorkerStatus, WorkerTask } from '../../../shared/protocol';
import { isAsleep, type WorkerPr } from '../../../shared/status';
import { isRtl, lang, ltrText, t, type TextKey } from '../../i18n';
import { cardSprite, textSprite } from '../toon';

// What a worker shows of how it's getting on: its status light, and the bubble or task card over its head.

export const STATUS_BULB: Record<string, string> = {
  starting: '#adb5bd',
  idle: '#8ecae6',
  working: '#ffd166',
  needs_input: '#ef476f',
  done: '#06d6a0',
  exited: '#6c757d',
  offline: '#6c757d',
};

/** A worker that needs you: its bubble is the red of its light, in white capitals, and its card is outlined in it (unless a pull request's color is). */
const NEEDS_YOU = { text: 'desks.chip.needsYou' as TextKey, bg: STATUS_BULB.needs_input, color: '#ffffff', size: 46, card: '#ffc2d1' };

/** Status pill on a worker's task card: [text, background, text color]. */
const TASK_CHIP: Record<string, [TextKey, string, string]> = {
  starting: ['desks.chip.starting', STATUS_BULB.starting, '#2b2d42'],
  idle: ['desks.chip.ready', STATUS_BULB.idle, '#2b2d42'],
  working: ['desks.chip.working', STATUS_BULB.working, '#2b2d42'],
  needs_input: [NEEDS_YOU.text, STATUS_BULB.needs_input, '#ffffff'],
  done: ['desks.chip.done', STATUS_BULB.done, '#2b2d42'],
  exited: ['desks.chip.asleep', STATUS_BULB.exited, '#ffffff'],
  offline: ['desks.chip.asleep', STATUS_BULB.offline, '#ffffff'],
};

/** The chip (or bubble) of a worker whose worktree was deleted outside the office. */
const LOST_CHIP: [TextKey, string, string] = ['desks.chip.lost', '#ffb703', '#2b2d42'];

/** The outline of a worker's bubble, and its pill, once it has a pull request: GitHub's open green, or the PR board's merged purple. */
const PR_INK: Record<WorkerPr['state'], string> = { open: '#2da44e', merged: '#9d4edd' };
const PR_ICON: Record<WorkerPr['state'], string> = { open: '🔀', merged: '🎉' };
const PR_LABEL: Record<WorkerPr['state'], TextKey> = { open: 'desks.bubble.prOpen', merged: 'desks.bubble.prMerged' };

/**
 * The bubble (or the task card) over a worker's head, and a key that changes whenever it would look
 * different (the language too, so a switch redraws it): `draw` makes it, or null for none.
 */
export function bubbleFor(status: WorkerStatus, bounce: boolean, task: WorkerTask | undefined, pr: WorkerPr | undefined, lost: boolean): { key: string; draw(): THREE.Sprite | null } {
  const hot = status === 'needs_input' || (status === 'done' && bounce);
  const asking = status === 'needs_input' && !lost;
  const bg = hot ? (status === 'done' ? '#caffbf' : NEEDS_YOU.card) : status === 'working' ? '#ffec99' : '#fffaf3';
  const border = pr ? PR_INK[pr.state] : asking ? NEEDS_YOU.bg : undefined;
  // Not working on or waiting for something more: its pull request in place of ready / done / asleep.
  // "PR #12" goes in as text (no thousands separator), kept left to right inside Arabic.
  const prRef = pr ? (isRtl() ? ltrText(`PR #${pr.number}`) : `PR #${pr.number}`) : '';
  const prLabel = pr && status !== 'working' && status !== 'needs_input' && status !== 'starting' ? t(PR_LABEL[pr.state], { icon: PR_ICON[pr.state], pr: prRef }) : undefined;
  const bubble = lost
    ? t('desks.bubble.lost')
    : prLabel ?? (status === 'needs_input' ? t(NEEDS_YOU.text) : status === 'done' && bounce ? t('desks.bubble.done') : status === 'working' ? t('desks.bubble.working') : isAsleep(status) ? '💤' : '');
  const key = `${lang()}|${lost}|${border}|${prLabel}|${task ? `${status}|${bounce}|${task.name}|${task.summary}` : bubble}`;
  return {
    key,
    draw: () => {
      if (task) {
        const [text, chipBg, color] = lost ? [t(LOST_CHIP[0]), LOST_CHIP[1], LOST_CHIP[2]] : prLabel ? [prLabel.toUpperCase(), border!, '#ffffff'] : chipOf(status);
        return cardSprite({ chip: { text, bg: chipBg, color }, title: task.name, body: task.summary, bg: isAsleep(status) ? '#e9ecef' : bg, border });
      }
      if (asking) return textSprite(bubble, { bg: NEEDS_YOU.bg, color: NEEDS_YOU.color, size: NEEDS_YOU.size, border: pr && border });
      return bubble ? textSprite(bubble, { bg: lost ? LOST_CHIP[1] : bg, size: 38, border }) : null;
    },
  };
}

/** The status pill for `status`, in the language now. */
function chipOf(status: WorkerStatus): [string, string, string] {
  const [k, bg, color] = TASK_CHIP[status] ?? TASK_CHIP.idle;
  return [t(k), bg, color];
}
