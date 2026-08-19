/**
 * Per-engine plan fixtures, and the three things the parser must never do: invent a tree from a
 * non-plan, report a share above 100%, or produce a node with no operator name.
 *
 * The MSSQL fixture is a **transcript**, not an invention: the column set and the row shapes are what
 * `SET STATISTICS PROFILE ON` really returned from the harness container (`joinery-test-mssql`, SQL
 * Server 2022) for a two-table join, trimmed to the operators that matter. That is what makes the
 * `NodeId`/`Parent` linking and the own-cost arithmetic testable without a live server.
 */

import { describe, expect, it } from 'vitest';
import type { QueryResult, ResultSet } from '@joinery/shared';

import {
  PLAN_KIND,
  flattenPlan,
  planFromResult,
  planRequestFor,
  planSeverity,
  type PlanNode,
} from './execution-plan';

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

/** `EXPLAIN (FORMAT JSON) SELECT … FROM orders o JOIN customers c …`, ANALYZE-shaped. */
const PG_PLAN = [
  {
    Plan: {
      'Node Type': 'Hash Join',
      'Total Cost': 200,
      'Startup Cost': 20,
      'Plan Rows': 5000,
      'Actual Rows': 4800,
      'Actual Total Time': 12.5,
      'Hash Cond': '(o.customer_id = c.id)',
      Plans: [
        {
          'Node Type': 'Seq Scan',
          'Relation Name': 'orders',
          'Total Cost': 120,
          'Plan Rows': 12000,
          Filter: '(status = 2)',
          'Rows Removed by Filter': 400,
        },
        {
          'Node Type': 'Index Scan',
          'Relation Name': 'customers',
          'Index Name': 'customers_pkey',
          'Total Cost': 30,
          'Plan Rows': 900,
          'Index Cond': '(id > 10)',
          'Sort Key': ['c.name', 'c.id'],
          'Sort Method': 'quicksort',
        },
      ],
    },
    'Planning Time': 0.42,
    'Execution Time': 15.75,
  },
];

/** `EXPLAIN FORMAT=JSON SELECT … FROM orders JOIN customers …` with an ORDER BY. */
const MYSQL_PLAN = {
  query_block: {
    select_id: 1,
    cost_info: { query_cost: '400.00' },
    ordering_operation: {
      using_filesort: true,
      cost_info: { prefix_cost: '400.00' },
      nested_loop: [
        {
          table: {
            table_name: 'orders',
            access_type: 'ALL',
            rows_examined_per_scan: 24000,
            cost_info: { prefix_cost: '300.00' },
            attached_condition: '(`orders`.`status` = 2)',
          },
        },
        {
          table: {
            table_name: 'customers',
            access_type: 'eq_ref',
            key: 'PRIMARY',
            used_key_parts: ['id'],
            ref: ['db.orders.customer_id'],
            using_index: true,
            rows_examined_per_scan: 1,
            cost_info: { prefix_cost: '100.00' },
          },
        },
      ],
    },
  },
};

function resultOf(resultSets: ResultSet[]): QueryResult {
  return { queryId: 'q1', success: true, resultSets };
}

function jsonResult(document: unknown): QueryResult {
  return resultOf([
    {
      columns: [{ name: 'QUERY PLAN', type: 'text' }],
      rows: [{ 'QUERY PLAN': JSON.stringify(document) }],
    },
  ]);
}

const MSSQL_PROFILE_COLUMNS = [
  'Rows',
  'Executes',
  'StmtText',
  'StmtId',
  'NodeId',
  'Parent',
  'PhysicalOp',
  'LogicalOp',
  'Argument',
  'EstimateRows',
  'TotalSubtreeCost',
  'Warnings',
  'Type',
].map(name => ({ name, type: 'varchar' }));

/**
 * The statement's own rows FIRST, then the profile — which is the order SQL Server sends them in, and
 * why the parser finds the profile by its columns rather than taking `resultSets[1]`.
 */
const MSSQL_RESULT = resultOf([
  { columns: [{ name: 'name', type: 'varchar' }], rows: [{ name: 'joinery_test' }] },
  {
    columns: MSSQL_PROFILE_COLUMNS,
    rows: [
      {
        Rows: 26,
        Executes: 1,
        StmtText: 'SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id',
        StmtId: 1,
        NodeId: 1,
        Parent: 0,
        PhysicalOp: 'NULL',
        LogicalOp: 'NULL',
        Argument: 'NULL',
        EstimateRows: 256.8,
        TotalSubtreeCost: 2.0,
        Warnings: 'NULL',
        Type: 'SELECT',
      },
      {
        Rows: 26,
        Executes: 1,
        StmtText: '  |--Nested Loops(Inner Join)',
        StmtId: 1,
        NodeId: 2,
        Parent: 1,
        PhysicalOp: 'Nested Loops',
        LogicalOp: 'Inner Join',
        Argument: 'NULL',
        EstimateRows: 256.8,
        TotalSubtreeCost: 2.0,
        Warnings: 'NO JOIN PREDICATE',
        Type: 'PLAN_ROW',
      },
      {
        Rows: 2400,
        Executes: 1,
        StmtText: '       |--Index Scan(OBJECT:([joinery_test].[dbo].[orders].[nc1]))',
        StmtId: 1,
        NodeId: 3,
        Parent: 2,
        PhysicalOp: 'Index Scan',
        LogicalOp: 'Index Scan',
        Argument:
          'OBJECT:([joinery_test].[dbo].[orders].[nc1]),  WHERE:([joinery_test].[dbo].[orders].[status]=(2)) ORDERED FORWARD',
        EstimateRows: 24,
        TotalSubtreeCost: 1.2,
        Warnings: 'NULL',
        Type: 'PLAN_ROW',
      },
      {
        Rows: 26,
        Executes: 26,
        StmtText:
          '       |--Clustered Index Seek(OBJECT:([joinery_test].[dbo].[customers].[clst] AS [c]))',
        StmtId: 1,
        NodeId: 4,
        Parent: 2,
        PhysicalOp: 'Clustered Index Seek',
        LogicalOp: 'Clustered Index Seek',
        Argument:
          'OBJECT:([joinery_test].[dbo].[customers].[clst] AS [c]), SEEK:([c].[id]=[joinery_test].[dbo].[orders].[customer_id]) ORDERED FORWARD',
        EstimateRows: 1,
        TotalSubtreeCost: 0.3,
        Warnings: 'NULL',
        Type: 'PLAN_ROW',
      },
    ],
  },
]);

function node(root: PlanNode, type: string): PlanNode {
  const found = flattenPlan(root).find(row => row.node.type === type);
  if (found === undefined) throw new Error(`no ${type} node in the parsed plan`);
  return found.node;
}

// ── What each engine is asked ─────────────────────────────────────────────────────────────────

describe('planRequestFor', () => {
  it('asks PostgreSQL and MySQL for a plan without running the statement', () => {
    const pg = planRequestFor('postgresql', 'SELECT 1');
    expect(pg).toEqual({ sql: 'EXPLAIN (FORMAT JSON) SELECT 1', executes: false });

    const mysql = planRequestFor('mysql', 'SELECT 1');
    expect(mysql).toEqual({ sql: 'EXPLAIN FORMAT=JSON SELECT 1', executes: false });
  });

  it('declares that the MSSQL plan RUNS the statement', () => {
    // The whole reason the flag exists. `SET SHOWPLAN_*` cannot share a batch with the statement it
    // explains (Msg 1067), so the only plan reachable through `query.execute` is an executed one — and a
    // caller that forgets to confirm is a caller that deletes rows to draw a diagram.
    const mssql = planRequestFor('mssql', 'DELETE FROM orders WHERE id < 5');
    expect(mssql.executes).toBe(true);
    expect(mssql.sql).toContain('SET STATISTICS PROFILE ON');
    expect(mssql.sql).toContain('DELETE FROM orders WHERE id < 5');
    expect(mssql.sql).toContain('SET STATISTICS PROFILE OFF');
    // And never the statement that could not work.
    expect(mssql.sql).not.toContain('SHOWPLAN');
  });

  it('strips one trailing semicolon so the wrapper cannot produce an empty statement', () => {
    expect(planRequestFor('postgresql', 'SELECT 1;  ').sql).toBe('EXPLAIN (FORMAT JSON) SELECT 1');
  });

  it('names the kind of plan each engine gives', () => {
    expect(PLAN_KIND).toEqual({ postgresql: 'estimated', mysql: 'estimated', mssql: 'actual' });
  });
});

// ── PostgreSQL ────────────────────────────────────────────────────────────────────────────────

describe('planFromResult — PostgreSQL', () => {
  it('builds the tree, the costs and the timings', () => {
    const parsed = planFromResult(jsonResult(PG_PLAN), 'postgresql');
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.root.type).toBe('Hash Join');
    expect(parsed.root.details).toBe('Hash Cond: (o.customer_id = c.id)');
    expect(parsed.root.children.map(child => child.type)).toEqual(['Seq Scan', 'Index Scan']);
    expect(parsed.summary).toMatchObject({
      totalCost: 200,
      planningTime: 0.42,
      executionTime: 15.75,
    });

    const seqScan = node(parsed.root, 'Seq Scan');
    expect(seqScan.object).toBe('orders');
    expect(seqScan.details).toBe('Filter: (status = 2)');
    expect(seqScan.extra).toEqual(['Rows removed by filter: 400']);
    expect(seqScan.costPercent).toBeCloseTo(60);
  });

  it('warns about a sequential scan over a table big enough to matter', () => {
    const parsed = planFromResult(jsonResult(PG_PLAN), 'postgresql');
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(parsed.summary.warnings).toEqual(['Sequential scan on orders (12000 rows)']);
  });

  it('prefers the relation name over the index name, and joins multi-column keys', () => {
    const parsed = planFromResult(jsonResult(PG_PLAN), 'postgresql');
    if (!parsed.ok) throw new Error(parsed.reason);
    const indexScan = node(parsed.root, 'Index Scan');
    expect(indexScan.object).toBe('customers');
    expect(indexScan.details).toBe('Index Cond: (id > 10) | Sort Key: c.name, c.id');
  });

  it('does not print "undefined" when a sort has no space figures', () => {
    // The Angular original interpolated `Sort Space Type` and `Sort Space Used` unconditionally.
    const parsed = planFromResult(jsonResult(PG_PLAN), 'postgresql');
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(node(parsed.root, 'Index Scan').extra).toEqual(['Sort: quicksort']);
  });

  it('reassembles a document split across rows', () => {
    // The fallback the Angular version had, and a real driver behaviour.
    const text = JSON.stringify(PG_PLAN);
    const halves = [text.slice(0, 40), text.slice(40)];
    const parsed = planFromResult(
      resultOf([
        {
          columns: [{ name: 'QUERY PLAN', type: 'text' }],
          rows: halves.map(half => ({ 'QUERY PLAN': half })),
        },
      ]),
      'postgresql'
    );
    expect(parsed.ok).toBe(true);
  });

  it('accepts an already-parsed json column', () => {
    const parsed = planFromResult(
      resultOf([
        { columns: [{ name: 'QUERY PLAN', type: 'json' }], rows: [{ 'QUERY PLAN': PG_PLAN }] },
      ]) as QueryResult,
      'postgresql'
    );
    expect(parsed.ok).toBe(true);
  });
});

// ── MySQL ─────────────────────────────────────────────────────────────────────────────────────

describe('planFromResult — MySQL', () => {
  it('nests the ordering operation and its joined tables', () => {
    const parsed = planFromResult(jsonResult(MYSQL_PLAN), 'mysql');
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.root.type).toBe('Query (with sort)');
    expect(parsed.summary.totalCost).toBe(400);
    const filesort = parsed.root.children[0];
    expect(filesort?.type).toBe('Filesort');
    expect(filesort?.children.map(child => child.object)).toEqual(['orders', 'customers']);
  });

  it('carries the access type and the covering-index note', () => {
    const parsed = planFromResult(jsonResult(MYSQL_PLAN), 'mysql');
    if (!parsed.ok) throw new Error(parsed.reason);

    const tables = flattenPlan(parsed.root)
      .map(row => row.node)
      .filter(candidate => candidate.type === 'Table Scan');
    expect(tables.map(table => table.accessType)).toEqual(['ALL', 'eq_ref']);
    expect(tables[1]?.details).toBe('Key: PRIMARY | Parts: id | Ref: db.orders.customer_id');
    expect(tables[1]?.extra).toEqual(['Using index (covering)']);
  });

  it('reports each warning once, however many nodes carry it', () => {
    const parsed = planFromResult(jsonResult(MYSQL_PLAN), 'mysql');
    if (!parsed.ok) throw new Error(parsed.reason);
    // Root-first order: the Filesort operation carries the note, and the table it feeds comes after.
    expect(parsed.summary.warnings).toEqual([
      'Using filesort',
      'Full table scan on orders (24000 rows)',
    ]);
  });
});

// ── MSSQL ─────────────────────────────────────────────────────────────────────────────────────

describe('planFromResult — MSSQL', () => {
  it('links the NodeId/Parent tree out of the profile result set', () => {
    const parsed = planFromResult(MSSQL_RESULT, 'mssql');
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.root.type).toBe('SELECT');
    expect(parsed.root.children.map(child => child.type)).toEqual(['Nested Loops']);
    const loops = node(parsed.root, 'Nested Loops');
    expect(loops.children.map(child => child.type)).toEqual(['Index Scan', 'Clustered Index Seek']);
    expect(parsed.summary.totalCost).toBe(2);
  });

  it('finds the profile by its columns, not by its position', () => {
    // The statement's own rows are `resultSets[0]`, and a two-statement selection would push the
    // profile further along still.
    const reordered = resultOf([...(MSSQL_RESULT.resultSets ?? [])].reverse());
    const parsed = planFromResult(reordered, 'mssql');
    expect(parsed.ok).toBe(true);
  });

  it('reads the object out of Argument and keeps the predicate', () => {
    const parsed = planFromResult(MSSQL_RESULT, 'mssql');
    if (!parsed.ok) throw new Error(parsed.reason);

    const seek = node(parsed.root, 'Clustered Index Seek');
    expect(seek.object).toBe('dbo.customers.clst');
    expect(seek.details).toContain('SEEK:([c].[id]=');
    // `LogicalOp` equals `PhysicalOp` here, so it is not repeated into the details line.
    expect(seek.details).not.toContain('Clustered Index Seek |');
  });

  it('shares cost on a node’s OWN cost, not on its subtree total', () => {
    const parsed = planFromResult(MSSQL_RESULT, 'mssql');
    if (!parsed.ok) throw new Error(parsed.reason);

    // Root subtree 2.0, its only child's subtree 2.0 → the root's own cost is 0. Sharing the subtree
    // total instead would put the root AND the Nested Loops at 100% and mark the whole spine expensive.
    expect(parsed.root.costPercent).toBe(0);
    // Nested Loops: 2.0 − (1.2 + 0.3) = 0.5 of 2.0.
    expect(node(parsed.root, 'Nested Loops').costPercent).toBeCloseTo(25);
    expect(node(parsed.root, 'Index Scan').costPercent).toBeCloseTo(60);
  });

  it('surfaces the server’s own warning and the estimate that was an order out', () => {
    const parsed = planFromResult(MSSQL_RESULT, 'mssql');
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.summary.warnings).toContain('NO JOIN PREDICATE — Nested Loops');
    // 24 estimated, 2,400 actual: the one thing only an executed plan can tell you.
    expect(parsed.summary.warnings).toContain('Index Scan estimated 24 rows and produced 2,400');
  });

  it('carries actual rows and executions, which the estimate-only engines have no answer for', () => {
    const parsed = planFromResult(MSSQL_RESULT, 'mssql');
    if (!parsed.ok) throw new Error(parsed.reason);
    const seek = node(parsed.root, 'Clustered Index Seek');
    expect(seek.actualRows).toBe(26);
    expect(seek.executions).toBe(26);
  });

  it('refuses, with a reason, when the batch produced no profile', () => {
    const parsed = planFromResult(
      resultOf([{ columns: [{ name: 'name', type: 'varchar' }], rows: [{ name: 'x' }] }]),
      'mssql'
    );
    expect(parsed).toEqual({
      ok: false,
      reason:
        'SQL Server returned no plan for this statement. STATISTICS PROFILE reports one only for a ' +
        'statement it could run.',
    });
  });
});

// ── The refusals ──────────────────────────────────────────────────────────────────────────────

describe('planFromResult — refusals', () => {
  it('passes the server’s error through rather than reporting an empty plan', () => {
    const parsed = planFromResult(
      { queryId: 'q', success: false, error: 'syntax error at or near "SELEC"' },
      'postgresql'
    );
    expect(parsed).toEqual({ ok: false, reason: 'syntax error at or near "SELEC"' });
  });

  it('refuses a result with no result sets', () => {
    const parsed = planFromResult({ queryId: 'q', success: true, resultSets: [] }, 'mysql');
    expect(parsed.ok).toBe(false);
  });

  it('refuses text that is not a plan document', () => {
    const parsed = planFromResult(
      resultOf([{ columns: [{ name: 'a', type: 'text' }], rows: [{ a: 'not json' }] }]),
      'mysql'
    );
    expect(parsed).toEqual({ ok: false, reason: 'The server’s answer was not a plan document.' });
  });

  it('refuses valid json that has no plan in it', () => {
    expect(planFromResult(jsonResult({ nope: true }), 'postgresql').ok).toBe(false);
    expect(planFromResult(jsonResult({ nope: true }), 'mysql').ok).toBe(false);
  });

  it('says so when nothing has run', () => {
    expect(planFromResult(null, 'postgresql')).toEqual({
      ok: false,
      reason: 'Nothing has run in this tab yet.',
    });
  });
});

// ── The view's two helpers ────────────────────────────────────────────────────────────────────

// ── Deep plans: every traversal in this file is a stack, not a recursion ───────────────────────
//
// `flattenPlan` was written as an explicit stack because a plan is server-shaped data. Two other passes
// were not, and had the same exposure from the other side: the PostgreSQL BUILD (`pgNode`) walked the plan
// document, and the MSSQL cost-share walked the linked tree — so a pathological plan overflowed the call
// stack before, or just after, the stack-safe flatten ever saw it. These are the tests that fail if either
// goes back to recursion.

describe('deep plans', () => {
  /** A PostgreSQL plan document nested `depth` levels down a single chain. */
  function deepPgDocument(depth: number): unknown {
    let plan: Record<string, unknown> = { 'Node Type': 'Seq Scan', 'Total Cost': 1 };
    for (let index = 0; index < depth; index += 1) {
      plan = { 'Node Type': `Nest ${index}`, 'Total Cost': index + 2, Plans: [plan] };
    }
    return [{ Plan: plan }];
  }

  it('parses a PostgreSQL plan far deeper than the call stack allows', () => {
    // Handed over ALREADY PARSED, which is a shape `firstColumnJson` accepts (pg's driver does exactly
    // this for a json column). `JSON.stringify` is itself recursive, so serialising the fixture would
    // make the test fail on the fixture rather than on the parser.
    const result = resultOf([
      {
        columns: [{ name: 'QUERY PLAN', type: 'json' }],
        rows: [{ 'QUERY PLAN': deepPgDocument(20_000) }],
      },
    ]);

    const parsed = planFromResult(result, 'postgresql');
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.root.type).toBe('Nest 19999');
    // Truncated at the shared bound rather than overflowing: the deepest 15,000 operators are dropped,
    // which is the same trade `flattenPlan` already made.
    expect(flattenPlan(parsed.root)).toHaveLength(5_000);
  });

  it('links and cost-shares an MSSQL profile far deeper than the call stack allows', () => {
    // One chain of 20,000 operators: NodeId n, Parent n−1, parents before children as SQL Server emits
    // them. `applyCostShare` used to recurse down this.
    const rows = Array.from({ length: 20_000 }, (_, index) => ({
      Rows: 1,
      Executes: 1,
      StmtText: `op ${index}`,
      StmtId: 1,
      NodeId: index + 1,
      Parent: index,
      PhysicalOp: index === 0 ? 'NULL' : `Op ${index}`,
      LogicalOp: 'NULL',
      Argument: 'NULL',
      EstimateRows: 1,
      TotalSubtreeCost: 20_000 - index,
      Warnings: 'NULL',
      Type: index === 0 ? 'SELECT' : 'PLAN_ROW',
    }));

    const parsed = planFromResult(resultOf([{ columns: MSSQL_PROFILE_COLUMNS, rows }]), 'mssql');
    if (!parsed.ok) throw new Error(parsed.reason);

    expect(parsed.root.type).toBe('SELECT');
    expect(parsed.summary.totalCost).toBe(20_000);
    // The share was written for every node the bounded pass reached, and 100% of the plan's cost is not
    // claimed by the spine: each operator's own cost here is 1 of 20,000.
    expect(parsed.root.costPercent).toBeCloseTo(0.005);
    expect(flattenPlan(parsed.root)).toHaveLength(5_000);
  });
});

describe('flattenPlan / planSeverity', () => {
  it('walks the tree root-first, in child order, with a depth per row', () => {
    const parsed = planFromResult(jsonResult(PG_PLAN), 'postgresql');
    if (!parsed.ok) throw new Error(parsed.reason);
    expect(flattenPlan(parsed.root).map(row => [row.node.type, row.depth])).toEqual([
      ['Hash Join', 0],
      ['Seq Scan', 1],
      ['Index Scan', 1],
    ]);
  });

  it('is bounded, so a pathological plan cannot hang the pane', () => {
    // 6,000 nodes in one chain — past the 5,000 cap.
    let deepest: PlanNode = { type: 'leaf', costPercent: 0, extra: [], children: [] };
    for (let index = 0; index < 6_000; index += 1) {
      deepest = { type: `n${index}`, costPercent: 0, extra: [], children: [deepest] };
    }
    expect(flattenPlan(deepest)).toHaveLength(5_000);
  });

  it('grades a node by its share of the plan', () => {
    const at = (costPercent: number): PlanNode => ({
      type: 'x',
      costPercent,
      extra: [],
      children: [],
    });
    expect(planSeverity(at(80))).toBe('expensive');
    expect(planSeverity(at(30))).toBe('moderate');
    expect(planSeverity(at(5))).toBe('cheap');
    expect(planSeverity(at(0))).toBe('neutral');
  });
});
