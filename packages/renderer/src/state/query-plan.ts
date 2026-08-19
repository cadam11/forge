/**
 * The execution plan each query tab is currently showing, and nothing else.
 *
 * ── Why a store rather than component state ──────────────────────────────────────────────────
 *
 * Two components need it and neither can own it. The toolbar button that ASKS for a plan is in
 * `<QueryToolbar>` (driven by `<QueryPanel>`); the tab that RENDERS it is inside `<QueryResults>`, which
 * is memoised on purpose — it is PLAN.md's R2 boundary, so passing the plan down as a prop would give the
 * grid a new prop object on every panel render and defeat the memo (`render-isolation.spec.tsx` is the
 * test that catches exactly that). A store read with a selector costs the results pane a re-render when
 * the plan changes and costs the grid nothing.
 *
 * ── Tied to the RESULT, not to a flag ───────────────────────────────────────────────────────
 *
 * `PlanState.forResult` is the `QueryResult` object the plan was parsed out of, and the results pane only
 * offers a Plan tab while that identity is still the tab's current result. That is the same trick the
 * row inspector and the snapshot notice already use (`query-results.tsx`), and it is what retires a stale
 * plan with no effect and no invalidation call: run something else and the plan is not this result's any
 * more, so the tab goes away by itself. The Angular version kept `planData` in a signal that nothing
 * cleared until the next plan request, so the Plan tab stayed on screen — showing the previous
 * statement's plan — after any ordinary Execute.
 */

import { create } from 'zustand';
import type { DatabaseEngine, QueryResult } from '@joinery/shared';

import type { PlanNode, PlanSummary } from '../features/query/execution-plan';

export interface PlanState {
  /** The result this plan was read out of. The pane compares identities; nothing else reads it. */
  readonly forResult: QueryResult;
  readonly engine: DatabaseEngine;
  /** Whether obtaining it ran the statement — rendered, because the two are not the same claim. */
  readonly kind: 'estimated' | 'actual';
  readonly root: PlanNode;
  readonly summary: PlanSummary;
  /** The statement the plan is FOR — not the `EXPLAIN …` wrapper that was sent. */
  readonly sql: string;
}

export interface QueryPlanStoreState {
  /** One entry per tab that has a plan on screen. Absent means "no Plan tab for this tab". */
  readonly plans: ReadonlyMap<string, PlanState>;
  readonly setPlan: (tabId: string, plan: PlanState) => void;
  /** Drops a tab's plan. Called when the tab closes, and when a plan request fails. */
  readonly forgetTab: (tabId: string) => void;
}

export type QueryPlanStore = ReturnType<typeof createQueryPlanStore>;

export function createQueryPlanStore() {
  return create<QueryPlanStoreState>()(set => ({
    plans: new Map(),

    setPlan: (tabId, plan) =>
      set(state => {
        const plans = new Map(state.plans);
        plans.set(tabId, plan);
        return { plans };
      }),

    forgetTab: tabId =>
      set(state => {
        if (!state.plans.has(tabId)) return state;
        const plans = new Map(state.plans);
        plans.delete(tabId);
        return { plans };
      }),
  }));
}

export const queryPlanStore = createQueryPlanStore();
export const useQueryPlanStore = queryPlanStore;

/**
 * The plan for this tab, or `null`.
 *
 * The result identity is checked HERE rather than in the pane, so no caller can forget it: a plan whose
 * result is not the one on screen is not this tab's plan, and the selector says so.
 */
export function selectPlanFor(tabId: string | undefined, result: QueryResult | null) {
  return (state: Pick<QueryPlanStoreState, 'plans'>): PlanState | null => {
    if (tabId === undefined || result === null) return null;
    const plan = state.plans.get(tabId) ?? null;
    return plan !== null && plan.forResult === result ? plan : null;
  };
}
