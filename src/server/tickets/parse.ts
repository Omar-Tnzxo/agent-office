// Reading the files a floor keeps its work in: a ticket's front matter, its goal and its chain log,
// an approval waiting on the owner, a role's card. Pure: nothing here touches the disk. A file that
// doesn't read as one of these gives nothing, and a row that doesn't read as one is skipped.
import { createHash } from 'node:crypto';
import type { ApprovalSummary, ChainRow, HandoffKind } from '../../shared/protocol.js';
import { isReviewStage, stageName } from '../../shared/tickets.js';
import { truncate } from '../workers/util.js';

/** How much of a chain row's Did and Result is kept, and of a ticket's title. */
const DID_CHARS = 160;
const RESULT_CHARS = 120;
const TITLE_CHARS = 90;

/** The `key: value` lines between a file's opening and closing `---`, and what comes after. Undefined when it opens without them. */
export function frontMatter(text: string): { fields: Record<string, string>; body: string } | undefined {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return undefined;
  const fields: Record<string, string> = {};
  for (let i = 1; i < Math.min(lines.length, 200); i++) {
    const line = lines[i];
    if (line.trim() === '---') return { fields, body: lines.slice(i + 1).join('\n') };
    // Only plain top-level keys; a list item or an indented line under one is left out.
    const m = /^([A-Za-z_][\w-]{0,40}):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    fields[m[1].toLowerCase()] = value;
  }
  return undefined;
}

/** A role named in a cell (`graphic-designer`, `creative-director: directions: ...`): its slug, or none ("none", "-", nothing). */
export function roleSlug(cell: string | undefined): string | undefined {
  const m = /^[`*_\s]*([A-Za-z][A-Za-z0-9-]{0,48})/.exec(cell ?? '');
  const slug = m?.[1].toLowerCase().replace(/-+$/, '');
  return slug && slug !== 'none' && slug !== 'nobody' ? slug : undefined;
}

/** A markdown table row's cells: split at the pipes that aren't escaped, `\|` read as a pipe. */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

const isSeparator = (line: string) => /^\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/.test(line.trim());

/**
 * What a row's result says it did: sent the work back ("returned", "back to copy", "fail, return 1",
 * "copy stage (return 1)"; not "returns 0", which only resets the count), handed it in to be looked
 * over (the stage it names first is a review: "copy-review stage", "approved, quality stage"), or
 * passed it on.
 */
export function kindOf(result: string): HandoffKind {
  if (/^\s*(returned|return|back to|sent back|fail(ed)?|rejected|changes requested)\b/i.test(result) || /\breturn(ed)?\s+\d/i.test(result)) return 'return';
  if (isReviewStage(stageIn(result))) return 'review';
  return 'handoff';
}

/** Words before or after "stage" that aren't a stage's name ("no change of stage", "the same stage"). */
const NOT_A_STAGE = new Set(['of', 'the', 'this', 'that', 'same', 'no', 'next', 'each', 'every', 'a', 'an', 'its', 'one', 'new', 'old', 'current', 'unchanged', 'and', 'or', 'to', 'at', 'in', 'on']);

/** The first stage a result names: "stage `copy-review`", "copy-review stage", "md-approval; then ...". */
export function stageIn(result: string): string | undefined {
  const pick = (m: RegExpExecArray | null) => (m && !NOT_A_STAGE.has(m[1].toLowerCase()) ? m[1].toLowerCase() : undefined);
  const named = pick(/\bstage\s+`?([A-Za-z0-9][\w-]{0,40})`?/i.exec(result)) ?? pick(/`?([A-Za-z0-9][\w-]{0,40})`?\s+stage\b/i.exec(result));
  if (named) return named;
  // Else a review's name on its own among the first words ("copy-review, checking only the two changes").
  return result
    .slice(0, 60)
    .toLowerCase()
    .match(/[a-z][a-z0-9-]*/g)
    ?.find((w) => isReviewStage(w));
}

/** A row that left the ticket where it was ("no change of stage", "graphic-designer (unchanged)"): no handoff, whatever its Next says. */
export function leftAsIs(result: string, nextCell: string): boolean {
  return /\bno change\b|\bunchanged\b/i.test(result) || /\(unchanged\)|\bunchanged\b/i.test(nextCell);
}

/** What tells one row from another, whatever else changed in the file: a short hash of its cells. */
export function rowPrint(r: Pick<ChainRow, 'when' | 'role' | 'did' | 'result' | 'next'>): string {
  return createHash('sha1').update(`${r.when}|${r.role}|${r.did.slice(0, 40)}|${r.result}|${r.next ?? ''}`).digest('hex').slice(0, 16);
}

/**
 * The rows of a ticket's chain log: the table under its "Chain log" heading, `| When | Role | Did |
 * Result | Next |`. The header says which column is which. A row missing only its last cell (a Next
 * nobody wrote) is read with it empty; one with fewer cells, no role or not a role's slug in it is
 * skipped, and the extra cells of one with an unescaped pipe in it go back into its Did.
 */
export function chainLog(body: string, ticket: string): ChainRow[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,4}\s*chain log\b/i.test(l.trim()));
  if (start < 0) return [];
  const out: ChainRow[] = [];
  let header: string[] | null = null;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (header) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) break;
    if (!line.startsWith('|')) {
      if (header) break;
      continue;
    }
    if (isSeparator(line)) continue;
    let row = cells(line);
    if (!header) {
      header = row.map((c) => c.toLowerCase());
      continue;
    }
    const col = (name: string, at: number) => {
      const i = header!.indexOf(name);
      return i >= 0 ? i : at;
    };
    const did = col('did', 2);
    if (row.length > header.length && did < header.length) {
      const extra = row.length - header.length;
      row = [...row.slice(0, did), row.slice(did, did + extra + 1).join(' | '), ...row.slice(did + extra + 1)];
    }
    // Only the last cell may be missing.
    if (row.length < header.length - 1 || (row.length < header.length && col('next', 4) !== header.length - 1)) continue;
    // The role cell is a slug and nothing else ("Creative Director!" is a row written some other way).
    const roleCell = (row[col('role', 1)] ?? '').replace(/[`*_]/g, '').trim();
    const role = /^[A-Za-z][A-Za-z0-9-]{0,48}$/.test(roleCell) ? roleSlug(roleCell) : undefined;
    if (!role) continue;
    const result = row[col('result', 3)] ?? '';
    const nextCell = row[col('next', 4)] ?? '';
    const next = roleSlug(nextCell);
    out.push({
      ticket,
      when: truncate(row[col('when', 0)] ?? '', 24),
      role,
      did: truncate(row[did] ?? '', DID_CHARS),
      result: truncate(result, RESULT_CHARS),
      ...(next ? { next } : {}),
      kind: kindOf(result),
      ...(leftAsIs(result, nextCell) ? { same: true as const } : {}),
    });
  }
  return out;
}

/** The first paragraph under a ticket's "Goal" heading, made one line and short. */
export function goalOf(body: string): string | undefined {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^#{1,4}\s*goal\b/i.test(l.trim()));
  if (start < 0) return undefined;
  const para: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,6}\s/.test(line) || (!line && para.length)) break;
    if (line) para.push(line);
  }
  const text = para.join(' ').replace(/[`*_]/g, '');
  return text ? truncate(text, TITLE_CHARS) : undefined;
}

/** A ticket.md as the office keeps it: its front matter's fields, its title, and its chain log. Undefined when it has no front matter. */
export interface ParsedTicket {
  id: string;
  title: string;
  status: string;
  stage: string;
  next?: string;
  due?: string;
  line?: string;
  rows: ChainRow[];
}

export function parseTicket(folder: string, text: string): ParsedTicket | undefined {
  const fm = frontMatter(text);
  if (!fm) return undefined;
  const f = fm.fields;
  const id = f.id || folder;
  return {
    id,
    title: goalOf(fm.body) ?? id,
    status: (f.status || 'open').toLowerCase(),
    // Its name, without a note after it ("directions (round 5, R20 on CalcRealty)" is directions).
    stage: /^[`*_\s]*([A-Za-z0-9][\w-]{0,40})/.exec(f.stage ?? '')?.[1].toLowerCase() ?? '',
    ...(roleSlug(f.next_role) ? { next: roleSlug(f.next_role) } : {}),
    ...(f.due ? { due: truncate(f.due, 24) } : {}),
    ...(f.line ? { line: truncate(f.line, 32) } : {}),
    rows: chainLog(fm.body, folder),
  };
}

/** An approval waiting on the owner (approvals/pending/<id>.md), from its front matter. */
export function parseApproval(name: string, text: string): ApprovalSummary {
  const f = frontMatter(text)?.fields ?? {};
  const ticket = (f.ticket ?? '').replace(/^work\//, '').replace(/\/+$/, '');
  return {
    id: name,
    ...(ticket ? { ticket: truncate(ticket, 80) } : {}),
    ...(f.sent ? { sent: truncate(f.sent, 24) } : {}),
    ...(f.decision_needed ? { decision: truncate(f.decision_needed, 160) } : {}),
  };
}

/** A role card's name: its first heading ("# Graphic Designer"). */
export function roleTitle(text: string): string | undefined {
  const m = /^#\s+(.+)$/m.exec(text.slice(0, 2000));
  return m ? truncate(m[1].replace(/[`*_]/g, ''), 40) : undefined;
}

/**
 * The few words a ticket's giver says handing it over: "Back for changes" for a return, the stage it
 * just did with a tick for an approval ("Copy review ✔"), and what it did otherwise. `did` is the
 * stage the ticket was at before this row: the one its giver just did.
 */
export function sayOf(kind: HandoffKind, result: string, did: string | undefined): string {
  const stage = did ? stageName(did) : '';
  const short = (s: string) => truncate(s, 30);
  if (kind === 'return') return 'Back for changes';
  // A review passed on (approved, or on to the next look) is a tick on the review it was.
  if (/^\s*(approved|pass(ed)?|ok)\b/i.test(result) || isReviewStage(did)) return short(stage ? `${stage} ✔` : 'Approved ✔');
  if (kind === 'review') return short(stage ? `${stage} for review` : 'Ready for review');
  return short(stage ? `${stage} done` : 'Over to you');
}
