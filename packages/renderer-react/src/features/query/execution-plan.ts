/**
 * Execution plans: how each engine is ASKED for one, and how the answer becomes a tree.
 *
 * Replaces the parsing half of `shared/components/execution-plan/execution-plan.component.ts` (791, of
 * which ~430 were a stylesheet and a template) plus `query.component.ts:2421-2532` — the EXPLAIN-wrapping
 * and plan-extraction half, which lived in the 2,689-line query component. Both halves are pure functions
 * here so the fixtures can be per-engine and the view can be dumb.
 *
 * ── The three engines ask three different questions, and only two of them are free ──────────
 *
 * | engine     | how                            | runs the statement? | actual rows? |
 * | ---------- | ------------------------------ | ------------------- | ------------ |
 * | postgresql | `EXPLAIN (FORMAT JSON) …`      | **no**              | no           |
 * | mysql      | `EXPLAIN FORMAT=JSON …`        | **no**              | no           |
 * | mssql      | `SET STATISTICS PROFILE ON; …` | **YES**             | yes          |
 *
 * That last row is the finding, and it is why `PlanRequest.executes` exists rather than a comment. The
 * Angular original sent `SET SHOWPLAN_TEXT ON;\n<sql>\nSET SHOWPLAN_TEXT OFF;` as ONE batch, and SQL
 * Server refuses that outright:
 *
 *     Msg 1067, Level 15 — The SET SHOWPLAN statements must be the only statements in the batch.
 *
 * Verified against the harness container (`joinery-test-mssql`, SQL Server 2022), including the two
 * workarounds worth trying: `EXEC('SET SHOWPLAN_ALL ON')` sets it inside a nested batch that ends
 * immediately, and `SET SHOWPLAN_ALL ON; EXEC('<sql>')` fails with the same 1067. So the MSSQL execution
 * plan in the Angular renderer **never produced a plan** — the button raised a server error and dropped
 * the user on the Messages tab. `SET STATISTICS PROFILE ON` has no such restriction and gives a strictly
 * better plan (a real parent-pointer tree with ACTUAL row counts, which is SSMS's "Include Actual
 * Execution Plan"), at the cost of running the statement. The caller is required to confirm that; see
 * `ConfirmExecuteDialog`'s `actual-plan` gate.
 *
 * An estimate-only MSSQL plan needs a main-process `query.explain` that owns the session for two
 * batches. That is J-68, and it is deliberately not faked here.
 */

import type { DatabaseEngine, QueryResult, ResultSet } from '@joinery/shared';

/** One node of a normalized plan. Every engine's answer is flattened into this shape. */
export interface PlanNode {
  /** The operator: `Seq Scan`, `Nested Loops`, `Table Scan`. Never empty. */
  readonly type: string;
  /** The table or index it touches, when the engine names one. */
  readonly object?: string;
  /** The one-line predicate summary — filters, join and sort keys — joined with ` | `. */
  readonly details?: string;
  /** Estimated total cost, in the engine's own units. */
  readonly cost?: number;
  readonly startupCost?: number;
  /** Estimated rows. */
  readonly rows?: number;
  /** Rows the engine really produced. Only an executed plan has these. */
  readonly actualRows?: number;
  readonly actualTime?: number;
  /** How many times this node ran. MSSQL's `Executes`; absent elsewhere. */
  readonly executions?: number;
  /** `cost` as a share of the plan's total, 0–100. Drives the cost bar and the node's severity. */
  readonly costPercent: number;
  /** MySQL's `access_type` (`ALL`, `ref`, `eq_ref`…). Absent on the other engines. */
  readonly accessType?: string;
  /** Notes the engine attaches: `Using filesort`, `NO JOIN PREDICATE`, rows removed by a filter. */
  readonly extra: readonly string[];
  readonly children: readonly PlanNode[];
}

export interface PlanSummary {
  readonly totalCost: number;
  readonly planningTime?: number;
  readonly executionTime?: number;
  /** Things worth reading before the tree. Derived, never echoed from a fixed list. */
  readonly warnings: readonly string[];
}

/** A parsed plan, or the reason there is not one. Never a half-populated tree. */
export type PlanParse =
  | {
      readonly ok: true;
      readonly engine: DatabaseEngine;
      readonly root: PlanNode;
      readonly summary: PlanSummary;
    }
  | { readonly ok: false; readonly reason: string };

/** What to send, and whether sending it has consequences. */
export interface PlanRequest {
  readonly sql: string;
  /**
   * True when obtaining the plan RUNS the user's statement. Only MSSQL, and the caller must confirm
   * before sending it — a `DELETE` whose plan a user wanted to look at must not delete anything by
   * accident.
   */
  readonly executes: boolean;
}

/** How each engine names the kind of plan it can give, for the UI to be honest about. */
export const PLAN_KIND: Record<DatabaseEngine, 'estimated' | 'actual'> = {
  postgresql: 'estimated',
  mysql: 'estimated',
  mssql: 'actual',
};

/**
 * The statement that asks this engine for a plan.
 *
 * PostgreSQL's and MySQL's are the Angular originals (`query.component.ts:2443-2450`). MSSQL's is not —
 * see the module header for what was there and why it could not work.
 */
export function planRequestFor(engine: DatabaseEngine, sql: string): PlanRequest {
  const statement = sql.trim().replace(/;\s*$/, '');
  switch (engine) {
    case 'postgresql':
      return { sql: `EXPLAIN (FORMAT JSON) ${statement}`, executes: false };
    case 'mysql':
      return { sql: `EXPLAIN FORMAT=JSON ${statement}`, executes: false };
    case 'mssql':
      return {
        sql: `SET STATISTICS PROFILE ON;\n${statement};\nSET STATISTICS PROFILE OFF;`,
        executes: true,
      };
  }
}

/**
 * Pull the plan out of what the engine returned, then parse it.
 *
 * One function rather than extract-then-parse, because the extraction is engine-specific in a way that
 * only makes sense next to the parse: PostgreSQL and MySQL put a JSON document in the first column of
 * the first row, while MSSQL's plan is a whole SECOND result set beside the query's own rows.
 */
export function planFromResult(result: QueryResult | null, engine: DatabaseEngine): PlanParse {
  if (result === null) return { ok: false, reason: 'Nothing has run in this tab yet.' };
  if (result.error !== undefined) return { ok: false, reason: result.error };

  const resultSets = result.resultSets ?? [];
  if (resultSets.length === 0) {
    return { ok: false, reason: 'The server returned no plan for this statement.' };
  }

  if (engine === 'mssql') return parseMssqlProfile(resultSets);

  const json = firstColumnJson(resultSets[0], engine);
  if (json === null) {
    return { ok: false, reason: 'The server’s answer was not a plan document.' };
  }
  return engine === 'postgresql' ? parsePostgresPlan(json) : parseMysqlPlan(json);
}

/**
 * How many nodes any one pass over a plan will visit.
 *
 * Bounded, per the repo's loop rule, and shared by every traversal in this file — the flatten, the
 * PostgreSQL build and the MSSQL cost-share pass. 5,000 nodes is far past any plan a human reads; a plan
 * bigger than that is truncated rather than allowed to hang the pane. One constant rather than three, so
 * a plan cannot be flattenable but not costable.
 */
const MAX_PLAN_NODES = 5_000;

/** The whole tree as a flat list, root first. Exported because the view needs it for rendering rows. */
export function flattenPlan(root: PlanNode): readonly { node: PlanNode; depth: number }[] {
  const rows: { node: PlanNode; depth: number }[] = [];
  // An explicit stack rather than recursion: a plan is server-shaped data and a pathological one must
  // not be able to overflow the renderer's call stack.
  const stack: { node: PlanNode; depth: number }[] = [{ node: root, depth: 0 }];
  const MAX_ROWS = MAX_PLAN_NODES;
  while (stack.length > 0 && rows.length < MAX_ROWS) {
    const entry = stack.pop();
    if (entry === undefined) break;
    rows.push(entry);
    for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
      const child = entry.node.children[index];
      if (child !== undefined) stack.push({ node: child, depth: entry.depth + 1 });
    }
  }
  return rows;
}

/** How expensive this node is relative to the plan. The view's three severities. */
export function planSeverity(node: PlanNode): 'expensive' | 'moderate' | 'cheap' | 'neutral' {
  if (node.costPercent > 50) return 'expensive';
  if (node.costPercent > 20) return 'moderate';
  if (node.costPercent > 0) return 'cheap';
  return 'neutral';
}

// ── PostgreSQL ────────────────────────────────────────────────────────────────────────────────

/**
 * `EXPLAIN (FORMAT JSON)` answers with a one-element array whose element has `Plan`, and — when the
 * statement was ANALYZEd — `Planning Time` / `Execution Time`. Ported from `parsePostgresPlan`.
 */
function parsePostgresPlan(data: unknown): PlanParse {
  const first = Array.isArray(data) ? data[0] : data;
  if (!isRecord(first)) return { ok: false, reason: 'The plan document had no plan in it.' };
  const plan = first['Plan'];
  if (!isRecord(plan)) return { ok: false, reason: 'The plan document had no plan in it.' };

  const totalCost = numberOf(plan['Total Cost']) ?? 0;
  const root = pgNode(plan, totalCost);
  return {
    ok: true,
    engine: 'postgresql',
    root,
    summary: {
      totalCost,
      planningTime: numberOf(first['Planning Time']),
      executionTime: numberOf(first['Execution Time']),
      warnings: pgWarnings(root),
    },
  };
}

/**
 * The PostgreSQL tree, built with an explicit stack.
 *
 * The same hazard `flattenPlan` guards, approached from the other end: `Plans` is server-shaped, so a
 * pathologically deep plan DOCUMENT could overflow the call stack during the parse — before the stack-safe
 * flatten ever got to see it. Same bound (`MAX_PLAN_NODES`), and past it the tree is truncated rather than
 * the pane being hung. Children keep their source order, because the stack appends them to their parent in
 * that order regardless of which order they are then descended in.
 */
function pgNode(plan: Record<string, unknown>, totalCost: number): PlanNode {
  const root = pgSelfNode(plan, totalCost);
  const pending: { source: Record<string, unknown>; node: MutablePlanNode }[] = [
    { source: plan, node: root },
  ];
  let built = 1;

  while (pending.length > 0 && built < MAX_PLAN_NODES) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const plans = entry.source['Plans'];
    for (const child of (Array.isArray(plans) ? plans : []).filter(isRecord)) {
      if (built >= MAX_PLAN_NODES) break;
      const childNode = pgSelfNode(child, totalCost);
      entry.node.children.push(childNode);
      pending.push({ source: child, node: childNode });
      built += 1;
    }
  }
  return root;
}

/** One PostgreSQL node, childless. `pgNode` owns the linking. */
function pgSelfNode(node: Record<string, unknown>, totalCost: number): MutablePlanNode {
  const cost = numberOf(node['Total Cost']) ?? 0;

  const details: string[] = [];
  addIf(details, 'Filter', node['Filter']);
  addIf(details, 'Index Cond', node['Index Cond']);
  addIf(details, 'Hash Cond', node['Hash Cond']);
  addIf(details, 'Join Filter', node['Join Filter']);
  addJoinedIf(details, 'Sort Key', node['Sort Key']);
  addJoinedIf(details, 'Group Key', node['Group Key']);

  const extra: string[] = [];
  const removed = numberOf(node['Rows Removed by Filter']);
  if (removed !== undefined && removed > 0) extra.push(`Rows removed by filter: ${removed}`);
  const sortMethod = stringOf(node['Sort Method']);
  if (sortMethod !== undefined) {
    // The Angular version interpolated `Sort Space Type` and `Sort Space Used` unconditionally, so a
    // plan without them read `Sort: quicksort (undefined: undefinedkB)`.
    const space = stringOf(node['Sort Space Type']);
    const used = numberOf(node['Sort Space Used']);
    extra.push(
      space !== undefined && used !== undefined
        ? `Sort: ${sortMethod} (${space}: ${used}kB)`
        : `Sort: ${sortMethod}`
    );
  }

  return {
    type: stringOf(node['Node Type']) ?? 'Unknown',
    object: stringOf(node['Relation Name']) ?? stringOf(node['Index Name']),
    details: details.length > 0 ? details.join(' | ') : undefined,
    cost,
    startupCost: numberOf(node['Startup Cost']),
    rows: numberOf(node['Plan Rows']),
    actualRows: numberOf(node['Actual Rows']),
    actualTime: numberOf(node['Actual Total Time']),
    costPercent: share(cost, totalCost),
    extra,
    children: [],
  };
}

/** A sequential scan over a table big enough to matter. The one heuristic the original had. */
function pgWarnings(root: PlanNode): readonly string[] {
  const warnings: string[] = [];
  for (const { node } of flattenPlan(root)) {
    if (node.type === 'Seq Scan' && (node.rows ?? 0) > 1_000) {
      warnings.push(`Sequential scan on ${node.object ?? 'a table'} (${node.rows} rows)`);
    }
  }
  return warnings;
}

// ── MySQL ─────────────────────────────────────────────────────────────────────────────────────

/** `EXPLAIN FORMAT=JSON` answers with `{ query_block: … }`. Ported from `parseMySQLPlan`. */
function parseMysqlPlan(data: unknown): PlanParse {
  if (!isRecord(data)) return { ok: false, reason: 'The plan document had no plan in it.' };
  const queryBlock = data['query_block'];
  if (!isRecord(queryBlock)) return { ok: false, reason: 'The plan document had no plan in it.' };

  const totalCost = numberOf(costInfo(queryBlock)?.['query_cost']) ?? 0;
  const root = mysqlNode(queryBlock, totalCost, 'Query');
  return {
    ok: true,
    engine: 'mysql',
    root,
    summary: { totalCost, warnings: mysqlWarnings(root) },
  };
}

function mysqlNode(
  node: Record<string, unknown>,
  totalCost: number,
  fallbackType: string
): PlanNode {
  const children: PlanNode[] = [];

  const nestedLoop = node['nested_loop'];
  if (Array.isArray(nestedLoop)) {
    for (const item of nestedLoop) {
      if (isRecord(item) && isRecord(item['table'])) {
        children.push(mysqlTableNode(item['table'], totalCost));
      }
    }
  }
  for (const [key, type] of MYSQL_OPERATIONS) {
    const nested = node[key];
    if (isRecord(nested)) children.push(mysqlNode(nested, totalCost, type));
  }
  if (isRecord(node['table'])) children.push(mysqlTableNode(node['table'], totalCost));
  const subqueries = node['optimized_away_subqueries'];
  if (Array.isArray(subqueries)) {
    for (const subquery of subqueries) {
      if (isRecord(subquery)) children.push(mysqlNode(subquery, totalCost, 'Subquery'));
    }
  }

  const info = costInfo(node);
  const cost = numberOf(info?.['query_cost']) ?? numberOf(info?.['prefix_cost']) ?? 0;

  const extra: string[] = [];
  if (node['using_filesort'] === true) extra.push('Using filesort');
  if (node['using_temporary_table'] === true) extra.push('Using temporary table');

  const message = stringOf(node['message']);
  const type =
    message ??
    (isRecord(node['ordering_operation']) && fallbackType === 'Query'
      ? 'Query (with sort)'
      : fallbackType);

  return {
    type,
    cost,
    costPercent: share(cost, totalCost),
    rows: numberOf(node['rows_examined_per_scan']),
    extra,
    children,
  };
}

/** The nested operations MySQL wraps a query block in, and the node type each becomes. */
const MYSQL_OPERATIONS: readonly (readonly [string, string])[] = [
  ['ordering_operation', 'Filesort'],
  ['grouping_operation', 'Group'],
  ['duplicates_removal', 'Distinct'],
];

function mysqlTableNode(table: Record<string, unknown>, totalCost: number): PlanNode {
  const info = costInfo(table);
  const cost = numberOf(info?.['prefix_cost']) ?? numberOf(info?.['read_cost']) ?? 0;

  const details: string[] = [];
  addIf(details, 'Key', table['key']);
  addJoinedIf(details, 'Parts', table['used_key_parts'], 'Parts');
  addIf(details, 'Where', table['attached_condition']);
  addJoinedIf(details, 'Ref', table['ref'], 'Ref');

  const extra: string[] = [];
  if (table['using_index'] === true) extra.push('Using index (covering)');
  if (table['using_MRR'] === true) extra.push('Using MRR');

  return {
    type: 'Table Scan',
    object: stringOf(table['table_name']),
    accessType: stringOf(table['access_type']),
    details: details.length > 0 ? details.join(' | ') : undefined,
    cost,
    costPercent: share(cost, totalCost),
    rows: numberOf(table['rows_examined_per_scan']),
    extra,
    children: [],
  };
}

function mysqlWarnings(root: PlanNode): readonly string[] {
  // A `Set`, because the original pushed "Using filesort" once per node that carried it and the summary
  // bar then repeated the same sentence three times for a three-table join.
  const warnings = new Set<string>();
  for (const { node } of flattenPlan(root)) {
    if (node.accessType === 'ALL' && (node.rows ?? 0) > 1_000) {
      warnings.add(`Full table scan on ${node.object ?? 'a table'} (${node.rows} rows)`);
    }
    for (const note of node.extra) {
      if (note === 'Using filesort' || note === 'Using temporary table') warnings.add(note);
    }
  }
  return [...warnings];
}

// ── MSSQL (`SET STATISTICS PROFILE ON`) ───────────────────────────────────────────────────────

/** The columns that identify a STATISTICS PROFILE result set among the statement's own result sets. */
const MSSQL_PROFILE_COLUMNS = ['NodeId', 'Parent', 'StmtText'] as const;

/**
 * MSSQL's plan arrives as its own result set: one row per operator, with `NodeId` and `Parent`
 * pointers, `Rows`/`Executes` (actual) and `EstimateRows`/`TotalSubtreeCost` (estimated).
 *
 * Found by SHAPE, not by index: the statement's own rows come first and a batch may return several
 * result sets, so "the second one" is a guess that breaks on a two-statement selection.
 */
function parseMssqlProfile(resultSets: readonly ResultSet[]): PlanParse {
  const profile = resultSets.find(set =>
    MSSQL_PROFILE_COLUMNS.every(column => set.columns.some(candidate => candidate.name === column))
  );
  if (profile === undefined) {
    return {
      ok: false,
      reason:
        'SQL Server returned no plan for this statement. STATISTICS PROFILE reports one only for a ' +
        'statement it could run.',
    };
  }

  const byNodeId = new Map<number, { node: MutablePlanNode; parent: number }>();
  const order: number[] = [];
  for (const row of profile.rows) {
    const nodeId = numberOf(row['NodeId']);
    const parent = numberOf(row['Parent']);
    if (nodeId === undefined || parent === undefined) continue;
    byNodeId.set(nodeId, { node: mssqlNode(row), parent });
    order.push(nodeId);
  }

  const rootId = order.find(nodeId => {
    const entry = byNodeId.get(nodeId);
    return entry !== undefined && !byNodeId.has(entry.parent);
  });
  const rootEntry = rootId === undefined ? undefined : byNodeId.get(rootId);
  if (rootEntry === undefined) {
    return { ok: false, reason: 'The plan SQL Server returned had no root operator.' };
  }

  // Parents before children in the emitted order, so one pass links the whole tree.
  for (const nodeId of order) {
    if (nodeId === rootId) continue;
    const entry = byNodeId.get(nodeId);
    const parent = entry === undefined ? undefined : byNodeId.get(entry.parent);
    if (entry === undefined || parent === undefined) continue;
    parent.node.children.push(entry.node);
  }

  const totalCost = rootEntry.node.cost ?? 0;
  applyCostShare(rootEntry.node, totalCost);

  return {
    ok: true,
    engine: 'mssql',
    root: rootEntry.node,
    summary: { totalCost, warnings: mssqlWarnings(rootEntry.node) },
  };
}

/** The tree is built by mutation, so the node type is relaxed for exactly as long as that takes. */
type MutablePlanNode = Omit<PlanNode, 'children' | 'costPercent'> & {
  children: MutablePlanNode[];
  costPercent: number;
};

function mssqlNode(row: Record<string, unknown>): MutablePlanNode {
  const physical = stringOf(row['PhysicalOp']);
  const logical = stringOf(row['LogicalOp']);
  const argument = stringOf(row['Argument']);
  const warning = stringOf(row['Warnings']);

  const details: string[] = [];
  // `PhysicalOp` and `LogicalOp` agree on most operators and differ on the interesting ones — a Nested
  // Loops doing an Inner Join versus a Left Outer Join. Only the difference is worth a line.
  if (logical !== undefined && logical !== physical) details.push(logical);
  const predicate = mssqlPredicate(argument);
  if (predicate !== undefined) details.push(predicate);

  return {
    // `PhysicalOp` is NULL on the statement row, whose `Type` is the statement kind (`SELECT`).
    type: physical ?? stringOf(row['Type']) ?? 'Statement',
    object: mssqlObject(argument),
    details: details.length > 0 ? details.join(' | ') : undefined,
    cost: numberOf(row['TotalSubtreeCost']),
    rows: numberOf(row['EstimateRows']),
    actualRows: numberOf(row['Rows']),
    executions: numberOf(row['Executes']),
    costPercent: 0,
    extra: warning === undefined ? [] : [warning],
    children: [],
  };
}

/** `OBJECT:([db].[schema].[table].[index])` → `schema.table.index`. */
function mssqlObject(argument: string | undefined): string | undefined {
  if (argument === undefined) return undefined;
  const match = /OBJECT:\(([^)]*)\)/.exec(argument);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  const parts = raw
    .split(/\s+AS\s+/i)[0]
    ?.split('.')
    .map(part => part.trim().replace(/^\[|\]$/g, ''))
    .filter(part => part.length > 0);
  if (parts === undefined || parts.length === 0) return undefined;
  // Drop the database qualifier: every node in one plan carries the same one, so it is noise.
  return parts.slice(Math.max(0, parts.length - 3)).join('.');
}

/** The `SEEK:` or `WHERE:` clause, which is the part of `Argument` a reader is looking for. */
function mssqlPredicate(argument: string | undefined): string | undefined {
  if (argument === undefined) return undefined;
  const match = /(SEEK|WHERE|OUTER REFERENCES):.*/i.exec(argument);
  return match?.[0]?.trim();
}

function mssqlWarnings(root: PlanNode): readonly string[] {
  const warnings = new Set<string>();
  for (const { node } of flattenPlan(root)) {
    for (const note of node.extra) warnings.add(`${note} — ${node.type}`);
    // An estimate an order of magnitude under the truth is the single most useful thing an ACTUAL plan
    // can tell you, and it is only knowable because STATISTICS PROFILE ran the statement.
    const estimated = node.rows;
    const actual = node.actualRows;
    if (
      estimated !== undefined &&
      actual !== undefined &&
      estimated > 0 &&
      actual > estimated * 10
    ) {
      warnings.add(
        `${node.type} estimated ${formatCount(estimated)} rows and produced ${formatCount(actual)}`
      );
    }
  }
  return [...warnings];
}

/**
 * MSSQL reports `TotalSubtreeCost` on every node — a SUBTREE total — so sharing that against the plan
 * total would put the whole spine of the plan at 100% and mark every operator on it "expensive". The
 * share is taken on the node's OWN cost (its subtree minus its children's), which is what SSMS shows as
 * the operator cost and what a reader is looking for. `cost` keeps the subtree figure, because that is
 * what the column means and what the node's stat line is labelled with.
 *
 * Runs after the tree is linked, for the obvious reason: a node's own cost is not knowable until its
 * children are attached.
 *
 * An explicit stack, bounded by `MAX_PLAN_NODES`, for the reason `flattenPlan` gives: the tree it walks was
 * built from `NodeId`/`Parent` pointers a server supplied, and no such tree may be able to overflow the
 * renderer's call stack. Every node's share is written before its children are visited, so a plan truncated
 * at the bound leaves the nodes it did reach correct rather than half-written.
 */
function applyCostShare(root: MutablePlanNode, totalCost: number): void {
  const pending: MutablePlanNode[] = [root];
  let visited = 0;
  while (pending.length > 0 && visited < MAX_PLAN_NODES) {
    const node = pending.pop();
    if (node === undefined) break;
    visited += 1;
    const childCost = node.children.reduce((sum, child) => sum + (child.cost ?? 0), 0);
    const ownCost = Math.max(0, (node.cost ?? 0) - childCost);
    node.costPercent = share(ownCost, totalCost);
    for (const child of node.children) pending.push(child);
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────────────────────

/**
 * The JSON document PostgreSQL and MySQL put in the first column of the first row.
 *
 * The PostgreSQL fallback is the Angular original's, and it is real: `psql`-style clients receive a
 * multi-row answer whose rows concatenate into one document.
 */
function firstColumnJson(resultSet: ResultSet | undefined, engine: DatabaseEngine): unknown {
  if (resultSet === undefined) return null;
  const rows = resultSet.rows;
  const firstRow = rows[0];
  if (firstRow === undefined) return null;

  const firstValue = Object.values(firstRow)[0];
  // PostgreSQL's driver can hand back an already-parsed value for a `json` column.
  if (isRecord(firstValue) || Array.isArray(firstValue)) return firstValue;
  if (typeof firstValue !== 'string') return null;

  const direct = parseJson(firstValue);
  if (direct !== null) return direct;
  if (engine !== 'postgresql') return null;
  return parseJson(rows.map(row => String(Object.values(row)[0] ?? '')).join(''));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  // `'NULL'` is what a text-mode driver hands back for a null column, and it is never a real operator.
  return trimmed === '' || trimmed === 'NULL' ? undefined : trimmed;
}

function costInfo(node: Record<string, unknown>): Record<string, unknown> | undefined {
  const info = node['cost_info'];
  return isRecord(info) ? info : undefined;
}

function share(cost: number, totalCost: number): number {
  if (totalCost <= 0 || cost <= 0) return 0;
  return Math.min(100, (cost / totalCost) * 100);
}

function addIf(into: string[], label: string, value: unknown): void {
  const text = stringOf(value);
  if (text !== undefined) into.push(`${label}: ${text}`);
}

function addJoinedIf(into: string[], key: string, value: unknown, label = key): void {
  if (!Array.isArray(value)) return;
  const parts = value
    .map(item => stringOf(item))
    .filter((item): item is string => item !== undefined);
  if (parts.length > 0) into.push(`${label}: ${parts.join(', ')}`);
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}
