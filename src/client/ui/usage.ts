import { fmtCost, fmtTokens, tokensOf, type AgentProvider, type Usage } from '../../shared/protocol';
import { store } from '../state';
import { $, h } from './dom';
import { providerUsageState, providerUsageTracked, resolvedProvider } from './provider';
import { onLang, t, tn } from '../i18n';

export { fmtCost, fmtTokens, tokensOf };

function displayedCost(u: Usage): string {
  return u.costKnown === false ? t('panels.use.noCost') : fmtCost(u.cost);
}

/** The token split behind a figure, in three lines. */
const split = (input: number, output: number, reasoning: number, cacheWrite: number, cacheRead: number) => [
  t('panels.use.io', { input: fmtTokens(input), output: fmtTokens(output) }),
  t('panels.use.reasoning', { n: fmtTokens(reasoning) }),
  t('panels.use.cache', { write: fmtTokens(cacheWrite), read: fmtTokens(cacheRead) }),
];

/** e.g. "$0.42 · 38k tokens"; OpenCode's amount is explicitly an estimate. */
export function usageLabel(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true
    ? t('panels.use.noCost')
    : u.costKnown === false
      ? t('panels.use.noCost')
      : provider === 'opencode' ? t('panels.use.reported', { cost: fmtCost(u.cost) }) : fmtCost(u.cost);
  const partial = u.incomplete ? t('panels.use.partial') : '';
  // DeepSeek Harness reports what is in the context window, not a token split.
  if (provider === 'dsh') {
    const window = u.contextSize !== undefined ? ` / ${fmtTokens(u.contextSize)}` : '';
    const spend = u.costKnown === true ? `${fmtCost(u.cost)} · ` : '';
    return `${partial}${spend}${t('panels.use.context', { n: `${fmtTokens(tokensOf(u))}${window}` })}`;
  }
  return `${partial}${money} · ${t('panels.use.tokens', { n: fmtTokens(tokensOf(u)) })}`;
}

/** The breakdown behind a figure, for a tooltip. */
export function usageTitle(u: Usage, provider: AgentProvider = 'claude'): string {
  const money = provider === 'codex' && u.costKnown !== true ? t('panels.use.noCost') : u.costKnown === false ? t('panels.use.noCost') : fmtCost(u.cost);
  const calls = provider === 'codex' || u.callsKnown === false
    ? t('panels.use.noCalls')
    : provider === 'opencode'
      ? tn('panels.use.reportedCalls', u.calls)
      : tn('panels.use.calls', u.calls);
  const dshContext = u.contextSize !== undefined ? t('panels.use.contextOf', { n: fmtTokens(tokensOf(u)), max: fmtTokens(u.contextSize) }) : t('panels.use.contextTokens', { n: fmtTokens(tokensOf(u)) });
  return [
    ...(u.incomplete ? [t('panels.use.partialTitle')] : []),
    provider === 'codex'
      ? t('panels.use.codexTitle', { money, calls })
      : provider === 'opencode'
        ? t('panels.use.ocTitle', { money, calls })
        : provider === 'dsh'
          ? t('panels.use.dshTitle', { context: dshContext, cost: u.costKnown === true ? money : t('panels.use.unavailable'), calls })
          : t('panels.use.over', { money, calls }),
    ...split(u.input, u.output, u.reasoning ?? 0, u.cacheWrite, u.cacheRead),
  ].join('\n');
}

let drawn = false;
// Always on screen: a switch of language draws it again.
onLang(() => drawn && renderUsage());

export function overBudget(): boolean {
  const s = store.usage;
  return s.budget !== undefined && s.today.cost >= s.budget;
}

/** New hires are refused: the daily budget is spent and the office runs with --budget-pause. */
export const hiringPaused = () => store.usage.pauseHiring && overBudget();

/** The sidebar's spend lines: what the workers at their desks cost, today's total and the budget. */
export function renderUsage() {
  const s = store.usage;
  let now = 0;
  let currentOpenCodeCost = 0;
  let currentOpenCodeTokens = 0;
  let currentOpenCodeInput = 0;
  let currentOpenCodeOutput = 0;
  let currentOpenCodeReasoning = 0;
  let currentOpenCodeCacheWrite = 0;
  let currentOpenCodeCacheRead = 0;
  let currentOpenCodeReports = 0;
  let currentOpenCodeCostUnknown = false;
  let currentOpenCodeIncomplete = false;
  let openCodeWaiting = false;
  let currentCodexCost = 0;
  let currentCodexTokens = 0;
  let currentCodexInput = 0;
  let currentCodexOutput = 0;
  let currentCodexReasoning = 0;
  let currentCodexCacheWrite = 0;
  let currentCodexCacheRead = 0;
  let currentCodexReports = 0;
  let currentCodexCostUnknown = false;
  let currentCodexIncomplete = false;
  let codexWaiting = false;
  let currentDshTokens = 0;
  let currentDshContext = 0;
  let currentDshReports = 0;
  let currentDshCost = 0;
  let currentDshCostKnown = false;
  let dshWaiting = false;
  let untracked = false;
  for (const w of store.workers.values()) {
    if (w.kind !== 'agent') continue;
    const provider = resolvedProvider(w.provider, store.project);
    const state = providerUsageState(provider, store.project, w.usage);
    if (state === 'untracked') untracked = true;
    if (provider === 'opencode') {
      if (!w.usage) {
        openCodeWaiting = true;
        continue;
      }
      currentOpenCodeReports++;
      if (w.usage.incomplete) currentOpenCodeIncomplete = true;
      currentOpenCodeTokens += tokensOf(w.usage);
      currentOpenCodeInput += w.usage.input;
      currentOpenCodeOutput += w.usage.output;
      currentOpenCodeReasoning += w.usage.reasoning ?? 0;
      currentOpenCodeCacheWrite += w.usage.cacheWrite;
      currentOpenCodeCacheRead += w.usage.cacheRead;
      if (w.usage.costKnown === false) currentOpenCodeCostUnknown = true;
      else currentOpenCodeCost += w.usage.cost;
    }
    if (provider === 'codex') {
      if (!w.usage) {
        codexWaiting = true;
        continue;
      }
      currentCodexReports++;
      if (w.usage.incomplete) currentCodexIncomplete = true;
      currentCodexTokens += tokensOf(w.usage);
      currentCodexInput += w.usage.input;
      currentCodexOutput += w.usage.output;
      currentCodexReasoning += w.usage.reasoning ?? 0;
      currentCodexCacheWrite += w.usage.cacheWrite;
      currentCodexCacheRead += w.usage.cacheRead;
      if (w.usage.costKnown !== true) currentCodexCostUnknown = true;
      else currentCodexCost += w.usage.cost;
    }
    if (provider === 'dsh') {
      if (!w.usage) {
        dshWaiting = true;
        continue;
      }
      currentDshReports++;
      currentDshTokens += tokensOf(w.usage);
      if (w.usage.contextSize !== undefined) currentDshContext = Math.max(currentDshContext, w.usage.contextSize);
      if (w.usage.costKnown === true) {
        currentDshCost += w.usage.cost;
        currentDshCostKnown = true;
      }
    }
    if (providerUsageTracked(provider, store.project, w.usage) && w.usage?.costKnown !== false && !w.usage?.incomplete) now += w.usage?.cost ?? 0;
  }
  const head = $('workers-cost');
  drawn = true;
  head.textContent = now > 0 ? fmtCost(now) : '';
  head.title = t('panels.use.headTitle');

  const el = $('usage');
  const any = s.total.calls > 0 || s.budget !== undefined || untracked || currentOpenCodeReports > 0 || openCodeWaiting || currentCodexReports > 0 || codexWaiting || currentDshReports > 0 || dshWaiting;
  el.classList.toggle('hidden', !any);
  if (!any) return;
  const over = overBudget();
  el.classList.toggle('over', over);
  const rows: HTMLElement[] = [];
  if (s.total.calls > 0 || s.budget !== undefined) {
    rows.push(
      h(
        'div.row',
        {},
        h('span', {}, t('panels.use.today')),
        h('b', { title: usageTitle(s.today, 'claude') }, displayedCost(s.today)),
        s.budget !== undefined ? h('span.muted', {}, t('panels.use.of', { budget: fmtCost(s.budget) })) : h('span.muted', {}, `· ${t('panels.use.tokens', { n: fmtTokens(tokensOf(s.today)) })}`),
      ),
    );
  }
  if (s.budget !== undefined) {
    const pct = Math.min(100, (s.today.cost / s.budget) * 100);
    const state = over ? (s.pauseHiring ? t('panels.use.spentPaused') : t('panels.use.spent')) : t('panels.use.pct', { pct: Math.round(pct) });
    rows.push(h('div.budget', { class: over ? 'over' : pct >= 80 ? 'near' : '', title: state, role: 'progressbar', 'aria-valuenow': Math.round(pct) }, h('div.fill', { style: `width:${pct}%` })));
  }
  if (s.total.calls > 0 || s.budget !== undefined) rows.push(h('div.row.muted', { title: usageTitle(s.total, 'claude') }, t('panels.use.allTime', { cost: displayedCost(s.total), n: fmtTokens(tokensOf(s.total)) })));
  if (currentOpenCodeReports > 0) {
    const amount = currentOpenCodeCostUnknown ? t('panels.use.noCost') : t('panels.use.reported', { cost: fmtCost(currentOpenCodeCost) });
    rows.push(
      h(
        'div.row.muted',
        { title: [t('panels.use.ocDesks'), ...split(currentOpenCodeInput, currentOpenCodeOutput, currentOpenCodeReasoning, currentOpenCodeCacheWrite, currentOpenCodeCacheRead)].join('\n') },
        t('panels.use.row', { provider: 'OpenCode', what: t(currentOpenCodeIncomplete ? 'panels.use.partialWord' : 'panels.use.desks'), amount, n: fmtTokens(currentOpenCodeTokens) }),
      ),
    );
  }
  if (openCodeWaiting) rows.push(h('div.row.muted', { title: t('panels.use.ocWait.title') }, t('panels.use.wait', { provider: 'OpenCode' })));
  if (currentCodexReports > 0) {
    const amount = currentCodexCostUnknown ? t('panels.use.noCost') : fmtCost(currentCodexCost);
    rows.push(
      h(
        'div.row.muted',
        { title: [t('panels.use.codexDesks'), ...split(currentCodexInput, currentCodexOutput, currentCodexReasoning, currentCodexCacheWrite, currentCodexCacheRead)].join('\n') },
        t('panels.use.row', { provider: 'Codex', what: t(currentCodexIncomplete ? 'panels.use.partialWord' : 'panels.use.desks'), amount, n: fmtTokens(currentCodexTokens) }),
      ),
    );
  }
  if (codexWaiting) rows.push(h('div.row.muted', { title: t('panels.use.codexWait.title') }, t('panels.use.wait', { provider: 'Codex' })));
  if (currentDshReports > 0) {
    const context = currentDshContext > 0 ? ` / ${fmtTokens(currentDshContext)}` : '';
    const spend = currentDshCostKnown ? `${fmtCost(currentDshCost)} · ` : '';
    rows.push(
      h(
        'div.row.muted',
        {
          title: [
            t('panels.use.dshDesks'),
            tn('panels.use.dshWorkers', currentDshReports, { tokens: `${fmtTokens(currentDshTokens)}${context}` }),
          ].join('\n'),
        },
        t('panels.use.dshRow', { spend, n: `${fmtTokens(currentDshTokens)}${context}` }),
      ),
    );
  }
  if (dshWaiting) rows.push(h('div.row.muted', { title: t('panels.use.dshWait.title') }, t('panels.use.wait', { provider: 'DeepSeek Harness' })));
  if (untracked) {
    rows.push(h('div.row.muted', { title: t('panels.use.custom.title') }, t('panels.use.custom')));
  }
  el.replaceChildren(...rows);
}
