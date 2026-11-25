// A floor whose repository keeps its work as tickets (work/<id>/ticket.md, see docs/features.md,
// "Handoffs and the review table"): what both sides need to agree on about them, and where the
// review table stands on the office floor.
import { MEETING_ROOM } from './layout.js';

/** A ticket in one of these states is finished, and off the floor. */
export const DONE_STATUSES: ReadonlySet<string> = new Set(['closed', 'cancelled', 'canceled', 'published', 'done']);

/** Whether a ticket with this status is still being worked on. */
export function isOpenStatus(status: string): boolean {
  return !DONE_STATUSES.has(status.trim().toLowerCase());
}

/**
 * Whether a stage is someone looking work over: `review`, anything ending in `-review`, `quality`, or
 * an approval inside the chain (`md-approval`). The owner's own approval is what approvals/pending is
 * for, so `owner-approval` isn't one.
 */
export function isReviewStage(stage: string | undefined): boolean {
  const s = (stage ?? '').trim().toLowerCase();
  if (!s || s === 'owner-approval') return false;
  return s === 'review' || s.endsWith('-review') || s === 'quality' || s.endsWith('-approval');
}

/** What a role, a name or a title goes by when they're compared: "Graphic Designer" and `graphic-designer` are both graphic-designer. */
export function roleKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A role's slug written out: graphic-designer is Graphic Designer. */
export function roleName(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** A stage's name written out: copy-review is Copy review. */
export function stageName(stage: string): string {
  const words = stage.split(/[-_\s]+/).filter(Boolean).join(' ');
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

/**
 * The review table: a counter against the meeting room's north glass, east of its door, facing the
 * lounge (-z), with the "In review" and "Waiting for you" trays on it. Only a floor that keeps
 * tickets has it (see features/handoffs), but the floor's routes always walk round it, the way they
 * do round the bean bags that aren't out yet.
 */
export const REVIEW_TABLE = { x: 14.4, z: MEETING_ROOM.minZ - 0.5, width: 2.2, depth: 0.7, height: 0.95 } as const;
