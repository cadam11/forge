/**
 * Execution Plan Component
 *
 * Renders a visual tree of a SQL execution plan for MySQL, PostgreSQL, or MSSQL.
 * Accepts raw EXPLAIN JSON (MySQL/PG) or SHOWPLAN text (MSSQL) and normalizes
 * into a common tree structure.
 */

import { Component, Input, OnChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import type { DatabaseEngine } from '@forgedb/shared';

/** Normalized plan node used for rendering */
export interface PlanNode {
  type: string;
  object?: string;
  details?: string;
  cost?: number;
  startupCost?: number;
  rows?: number;
  actualRows?: number;
  actualTime?: number;
  costPercent: number;
  accessType?: string;
  filtered?: number;
  extra: string[];
  children: PlanNode[];
}

export interface PlanSummary {
  totalCost: number;
  planningTime?: number;
  executionTime?: number;
  warnings: string[];
}

@Component({
  selector: 'app-execution-plan',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule, MatButtonModule],
  template: `
    <div class="execution-plan">
      @if (error()) {
        <div class="plan-error">
          <mat-icon>error_outline</mat-icon>
          <span>{{ error() }}</span>
        </div>
      } @else if (rootNodes().length > 0) {
        <!-- Summary bar -->
        <div class="plan-summary">
          @if (summary().totalCost > 0) {
            <span class="summary-item">
              <mat-icon>speed</mat-icon>
              Total Cost: {{ summary().totalCost | number: '1.2-2' }}
            </span>
          }
          @if (summary().planningTime != null) {
            <span class="summary-item">
              <mat-icon>build</mat-icon>
              Planning: {{ summary().planningTime | number: '1.3-3' }}ms
            </span>
          }
          @if (summary().executionTime != null) {
            <span class="summary-item">
              <mat-icon>timer</mat-icon>
              Execution: {{ summary().executionTime | number: '1.3-3' }}ms
            </span>
          }
          @for (warning of summary().warnings; track warning) {
            <span class="summary-item warning">
              <mat-icon>warning</mat-icon>
              {{ warning }}
            </span>
          }
          @if (mysqlExplainUrl) {
            <a
              class="summary-item link"
              [href]="mysqlExplainUrl"
              target="_blank"
              matTooltip="View visual plan on mysqlexplain.com"
            >
              <mat-icon>open_in_new</mat-icon>
              mysqlexplain.com
            </a>
          }
        </div>

        <!-- Plan tree -->
        <div class="plan-tree">
          @for (node of rootNodes(); track $index) {
            <ng-container *ngTemplateOutlet="planNodeTpl; context: { $implicit: node, depth: 0 }" />
          }
        </div>
      } @else {
        <div class="plan-empty">
          <mat-icon>info_outline</mat-icon>
          <span>No execution plan data available</span>
        </div>
      }
    </div>

    <!-- Recursive plan node template -->
    <ng-template #planNodeTpl let-node let-depth="depth">
      <div class="plan-node" [style.margin-left.px]="depth * 28">
        <div class="node-card" [class]="getNodeClass(node)">
          <div class="node-header">
            <div class="node-type">
              <mat-icon class="node-type-icon">{{ getNodeIcon(node) }}</mat-icon>
              <span class="type-label">{{ node.type }}</span>
              @if (node.accessType) {
                <span class="access-badge" [class]="'access-' + getAccessClass(node.accessType)">
                  {{ node.accessType }}
                </span>
              }
            </div>
            @if (node.object) {
              <span class="node-object">on {{ node.object }}</span>
            }
          </div>

          <div class="node-stats">
            @if (node.cost != null && node.cost > 0) {
              <div class="stat">
                <span class="stat-label">Cost</span>
                <span class="stat-value">{{
                  node.startupCost != null
                    ? (node.startupCost | number: '1.2-2') + '..' + (node.cost | number: '1.2-2')
                    : (node.cost | number: '1.2-2')
                }}</span>
              </div>
            }
            @if (node.rows != null) {
              <div class="stat">
                <span class="stat-label">Rows</span>
                <span class="stat-value">{{ node.rows | number }}</span>
              </div>
            }
            @if (node.actualRows != null) {
              <div class="stat">
                <span class="stat-label">Actual</span>
                <span class="stat-value">{{ node.actualRows | number }}</span>
              </div>
            }
            @if (node.actualTime != null) {
              <div class="stat">
                <span class="stat-label">Time</span>
                <span class="stat-value">{{ node.actualTime | number: '1.3-3' }}ms</span>
              </div>
            }
            @if (node.costPercent > 0) {
              <div class="cost-bar-container">
                <div
                  class="cost-bar"
                  [style.width.%]="node.costPercent"
                  [class.cost-high]="node.costPercent > 50"
                  [class.cost-medium]="node.costPercent > 20 && node.costPercent <= 50"
                  [class.cost-low]="node.costPercent <= 20"
                ></div>
                <span class="cost-pct">{{ node.costPercent | number: '1.1-1' }}%</span>
              </div>
            }
          </div>

          @if (node.details) {
            <div class="node-details">{{ node.details }}</div>
          }
          @for (extra of node.extra; track extra) {
            <div class="node-extra">{{ extra }}</div>
          }
        </div>

        <!-- Connector line -->
        @if (node.children.length > 0) {
          <div class="connector" [style.margin-left.px]="14"></div>
        }
      </div>
      @for (child of node.children; track $index) {
        <ng-container
          *ngTemplateOutlet="planNodeTpl; context: { $implicit: child, depth: depth + 1 }"
        />
      }
    </ng-template>
  `,
  styles: [
    `
      .execution-plan {
        height: 100%;
        overflow-y: auto;
        padding: var(--spacing-md);
        font-size: var(--font-size-sm);
      }

      .plan-summary {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-md);
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-md);
        background: var(--bg-tertiary);
        border-radius: var(--radius-md);
        border: 1px solid var(--border-primary);
        align-items: center;
      }

      .summary-item {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--font-size-xs);
        color: var(--text-secondary);

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }

        &.warning {
          color: var(--status-warning);
        }

        &.link {
          color: var(--status-info);
          text-decoration: none;
          cursor: pointer;

          &:hover {
            text-decoration: underline;
          }
        }
      }

      .plan-tree {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .plan-node {
        position: relative;
      }

      .node-card {
        border: 1px solid var(--border-primary);
        border-radius: var(--radius-md);
        padding: var(--spacing-sm) var(--spacing-md);
        background: var(--bg-primary);
        transition: border-color var(--transition-fast);
        border-left: 3px solid var(--border-secondary);

        &:hover {
          border-color: var(--accent);
        }

        &.node-expensive {
          border-left-color: var(--status-error);
          background: color-mix(in srgb, var(--status-error) 5%, var(--bg-primary));
        }

        &.node-moderate {
          border-left-color: var(--status-warning);
        }

        &.node-cheap {
          border-left-color: var(--status-success);
        }
      }

      .node-header {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
      }

      .node-type {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .node-type-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--text-secondary);
      }

      .type-label {
        font-weight: 600;
        color: var(--text-primary);
      }

      .access-badge {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        padding: 1px 6px;
        border-radius: 8px;
        letter-spacing: 0.03em;
      }

      .access-good {
        background: color-mix(in srgb, var(--status-success) 20%, transparent);
        color: var(--status-success);
      }

      .access-ok {
        background: color-mix(in srgb, var(--status-info) 20%, transparent);
        color: var(--status-info);
      }

      .access-warn {
        background: color-mix(in srgb, var(--status-warning) 20%, transparent);
        color: var(--status-warning);
      }

      .access-bad {
        background: color-mix(in srgb, var(--status-error) 20%, transparent);
        color: var(--status-error);
      }

      .node-object {
        color: var(--text-secondary);
        font-style: italic;
      }

      .node-stats {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        margin-top: 4px;
        flex-wrap: wrap;
      }

      .stat {
        display: flex;
        align-items: center;
        gap: 4px;

        .stat-label {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
        }

        .stat-value {
          font-size: var(--font-size-xs);
          color: var(--text-primary);
          font-weight: 500;
          font-variant-numeric: tabular-nums;
        }
      }

      .cost-bar-container {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
        min-width: 80px;
        max-width: 160px;
        height: 6px;
        background: var(--bg-tertiary);
        border-radius: 3px;
        overflow: visible;
        position: relative;
      }

      .cost-bar {
        height: 100%;
        border-radius: 3px;
        transition: width 0.3s ease;
      }

      .cost-high {
        background: var(--status-error);
      }
      .cost-medium {
        background: var(--status-warning);
      }
      .cost-low {
        background: var(--status-success);
      }

      .cost-pct {
        font-size: 10px;
        color: var(--text-muted);
        white-space: nowrap;
        margin-left: 4px;
      }

      .node-details,
      .node-extra {
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        margin-top: 4px;
        font-family: var(--font-mono, monospace);
        word-break: break-all;
      }

      .node-extra {
        color: var(--text-muted);
        font-style: italic;
      }

      .connector {
        width: 1px;
        height: 8px;
        background: var(--border-secondary);
      }

      .plan-error,
      .plan-empty {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-lg);
        color: var(--text-secondary);

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .plan-error {
        color: var(--status-error);
      }
    `,
  ],
})
export class ExecutionPlanComponent implements OnChanges {
  /** Raw plan data — either JSON string or parsed object */
  @Input() planData: unknown;
  /** Database engine to determine how to parse the plan */
  @Input() engine: DatabaseEngine = 'mssql';
  /** Optional URL to mysqlexplain.com for this plan */
  @Input() mysqlExplainUrl: string | null = null;

  readonly rootNodes = signal<PlanNode[]>([]);
  readonly summary = signal<PlanSummary>({ totalCost: 0, warnings: [] });
  readonly error = signal<string | null>(null);

  ngOnChanges(): void {
    this.parsePlan();
  }

  private parsePlan(): void {
    if (!this.planData) {
      this.rootNodes.set([]);
      this.error.set(null);
      return;
    }

    try {
      let data = this.planData;
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }

      switch (this.engine) {
        case 'postgresql':
          this.parsePostgresPlan(data);
          break;
        case 'mysql':
          this.parseMySQLPlan(data);
          break;
        case 'mssql':
          this.parseMSSQLPlan(data);
          break;
      }
      this.error.set(null);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to parse execution plan');
      this.rootNodes.set([]);
    }
  }

  // ──────────── PostgreSQL ────────────

  private parsePostgresPlan(data: unknown): void {
    const arr = Array.isArray(data) ? data : [data];
    const planRoot = arr[0] as {
      Plan?: unknown;
      'Planning Time'?: number;
      'Execution Time'?: number;
    };

    if (!planRoot?.Plan) {
      this.rootNodes.set([]);
      return;
    }

    const totalCost = ((planRoot.Plan as Record<string, unknown>)['Total Cost'] as number) || 0;
    const root = this.parsePgNode(planRoot.Plan as Record<string, unknown>, totalCost);

    this.rootNodes.set([root]);
    this.summary.set({
      totalCost,
      planningTime: planRoot['Planning Time'],
      executionTime: planRoot['Execution Time'],
      warnings: this.detectPgWarnings(root),
    });
  }

  private parsePgNode(node: Record<string, unknown>, totalCost: number): PlanNode {
    const cost = (node['Total Cost'] as number) || 0;
    const children = ((node['Plans'] as Record<string, unknown>[]) || []).map(c =>
      this.parsePgNode(c, totalCost)
    );

    const details: string[] = [];
    if (node['Filter']) details.push(`Filter: ${node['Filter']}`);
    if (node['Index Cond']) details.push(`Index Cond: ${node['Index Cond']}`);
    if (node['Hash Cond']) details.push(`Hash Cond: ${node['Hash Cond']}`);
    if (node['Join Filter']) details.push(`Join Filter: ${node['Join Filter']}`);
    if (node['Sort Key']) details.push(`Sort Key: ${(node['Sort Key'] as string[]).join(', ')}`);
    if (node['Group Key']) details.push(`Group Key: ${(node['Group Key'] as string[]).join(', ')}`);

    const extra: string[] = [];
    if (node['Rows Removed by Filter'])
      extra.push(`Rows removed by filter: ${node['Rows Removed by Filter']}`);
    if (node['Sort Method'])
      extra.push(
        `Sort: ${node['Sort Method']} (${node['Sort Space Type']}: ${node['Sort Space Used']}kB)`
      );

    const object = (node['Relation Name'] as string) || (node['Index Name'] as string) || undefined;

    return {
      type: (node['Node Type'] as string) || 'Unknown',
      object,
      details: details.join(' | ') || undefined,
      cost,
      startupCost: node['Startup Cost'] as number,
      rows: node['Plan Rows'] as number,
      actualRows: node['Actual Rows'] as number,
      actualTime: node['Actual Total Time'] as number,
      costPercent: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      extra,
      children,
    };
  }

  private detectPgWarnings(node: PlanNode): string[] {
    const warnings: string[] = [];
    this.walkNodes(node, n => {
      if (n.type === 'Seq Scan' && (n.rows ?? 0) > 1000) {
        warnings.push(`Sequential scan on ${n.object || 'table'} (${n.rows} rows)`);
      }
    });
    return warnings;
  }

  // ──────────── MySQL ────────────

  private parseMySQLPlan(data: unknown): void {
    const obj = data as Record<string, unknown>;
    const queryBlock = obj['query_block'] as Record<string, unknown>;
    if (!queryBlock) {
      this.rootNodes.set([]);
      return;
    }

    const totalCost = parseFloat(
      (queryBlock['cost_info'] as Record<string, string>)?.['query_cost'] || '0'
    );
    const root = this.parseMySQLNode(queryBlock, totalCost, 'Query');
    this.rootNodes.set([root]);
    this.summary.set({
      totalCost,
      warnings: this.detectMySQLWarnings(root),
    });
  }

  private parseMySQLNode(
    node: Record<string, unknown>,
    totalCost: number,
    fallbackType: string
  ): PlanNode {
    const children: PlanNode[] = [];

    // Parse nested_loop children
    const nestedLoop = node['nested_loop'] as Record<string, unknown>[];
    if (nestedLoop) {
      for (const item of nestedLoop) {
        const table = item['table'] as Record<string, unknown>;
        if (table) {
          children.push(this.parseMySQLTableNode(table, totalCost));
        }
      }
    }

    // Parse ordering_operation
    const ordering = node['ordering_operation'] as Record<string, unknown>;
    if (ordering) {
      children.push(this.parseMySQLNode(ordering, totalCost, 'Filesort'));
    }

    // Parse grouping_operation
    const grouping = node['grouping_operation'] as Record<string, unknown>;
    if (grouping) {
      children.push(this.parseMySQLNode(grouping, totalCost, 'Group'));
    }

    // Parse duplicates_removal
    const dedup = node['duplicates_removal'] as Record<string, unknown>;
    if (dedup) {
      children.push(this.parseMySQLNode(dedup, totalCost, 'Distinct'));
    }

    // Direct table access (single table query)
    const table = node['table'] as Record<string, unknown>;
    if (table) {
      children.push(this.parseMySQLTableNode(table, totalCost));
    }

    // Subqueries
    const subqueries = node['optimized_away_subqueries'] as Record<string, unknown>[];
    if (subqueries) {
      for (const sq of subqueries) {
        children.push(this.parseMySQLNode(sq, totalCost, 'Subquery'));
      }
    }

    const costInfo = node['cost_info'] as Record<string, string> | undefined;
    const cost = parseFloat(costInfo?.['query_cost'] || costInfo?.['prefix_cost'] || '0');

    const extra: string[] = [];
    if (node['using_filesort']) extra.push('Using filesort');
    if (node['using_temporary_table']) extra.push('Using temporary table');

    let type = fallbackType;
    if (node['ordering_operation'] && fallbackType === 'Query') type = 'Query (with sort)';
    if (node['message']) type = node['message'] as string;

    return {
      type,
      cost,
      costPercent: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      rows: node['rows_examined_per_scan'] as number,
      extra,
      children,
    };
  }

  private parseMySQLTableNode(table: Record<string, unknown>, totalCost: number): PlanNode {
    const costInfo = table['cost_info'] as Record<string, string> | undefined;
    const cost = parseFloat(costInfo?.['prefix_cost'] || costInfo?.['read_cost'] || '0');

    const details: string[] = [];
    if (table['key']) details.push(`Key: ${table['key']}`);
    if (table['used_key_parts'])
      details.push(`Parts: ${(table['used_key_parts'] as string[]).join(', ')}`);
    if (table['attached_condition']) details.push(`Where: ${table['attached_condition']}`);
    if (table['ref']) details.push(`Ref: ${(table['ref'] as string[]).join(', ')}`);

    const extra: string[] = [];
    if (table['using_index']) extra.push('Using index (covering)');
    if (table['using_MRR']) extra.push('Using MRR');

    return {
      type: 'Table Scan',
      object: table['table_name'] as string,
      accessType: table['access_type'] as string,
      details: details.join(' | ') || undefined,
      cost,
      costPercent: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      rows: table['rows_examined_per_scan'] as number,
      extra,
      filtered: parseFloat((table['filtered'] as string) || '0'),
      children: [],
    };
  }

  private detectMySQLWarnings(node: PlanNode): string[] {
    const warnings: string[] = [];
    this.walkNodes(node, n => {
      if (n.accessType === 'ALL' && (n.rows ?? 0) > 1000) {
        warnings.push(`Full table scan on ${n.object || 'table'} (${n.rows} rows)`);
      }
      if (n.extra.includes('Using filesort')) {
        warnings.push('Using filesort');
      }
      if (n.extra.includes('Using temporary table')) {
        warnings.push('Using temporary table');
      }
    });
    return warnings;
  }

  // ──────────── MSSQL (text plan) ────────────

  private parseMSSQLPlan(data: unknown): void {
    // MSSQL SHOWPLAN_TEXT returns rows of text. We present them as a simple tree.
    const textLines = this.extractMSSQLText(data);
    if (!textLines.length) {
      this.rootNodes.set([]);
      return;
    }

    const nodes: PlanNode[] = textLines.map(line => ({
      type: line.trim(),
      costPercent: 0,
      extra: [],
      children: [],
    }));

    // Nest based on indentation (| prefix depth)
    const root: PlanNode = { type: 'Query Plan', costPercent: 0, extra: [], children: [] };
    // For text plans, just show flat list under root
    root.children = nodes;
    this.rootNodes.set([root]);
    this.summary.set({ totalCost: 0, warnings: [] });
  }

  private extractMSSQLText(data: unknown): string[] {
    if (typeof data === 'string') return data.split('\n').filter(l => l.trim());
    if (Array.isArray(data)) {
      return data
        .map(row => {
          if (typeof row === 'string') return row;
          if (typeof row === 'object' && row) {
            const vals = Object.values(row);
            return vals[0] ? String(vals[0]) : '';
          }
          return '';
        })
        .filter(l => l.trim());
    }
    return [];
  }

  // ──────────── Helpers ────────────

  private walkNodes(node: PlanNode, fn: (n: PlanNode) => void): void {
    fn(node);
    for (const child of node.children) {
      this.walkNodes(child, fn);
    }
  }

  getNodeClass(node: PlanNode): string {
    if (node.costPercent > 50) return 'node-expensive';
    if (node.costPercent > 20) return 'node-moderate';
    if (node.costPercent > 0) return 'node-cheap';
    return '';
  }

  getNodeIcon(node: PlanNode): string {
    const t = node.type.toLowerCase();
    if (t.includes('seq scan') || t.includes('full') || node.accessType === 'ALL') return 'warning';
    if (
      t.includes('index') ||
      node.accessType === 'ref' ||
      node.accessType === 'eq_ref' ||
      node.accessType === 'const'
    )
      return 'bolt';
    if (t.includes('hash') || t.includes('merge')) return 'merge_type';
    if (t.includes('sort') || t.includes('filesort')) return 'sort';
    if (t.includes('aggregate') || t.includes('group')) return 'functions';
    if (t.includes('nested loop') || t.includes('nested_loop')) return 'account_tree';
    if (t.includes('limit')) return 'filter_list';
    return 'play_arrow';
  }

  getAccessClass(accessType: string): string {
    switch (accessType) {
      case 'const':
      case 'system':
      case 'eq_ref':
        return 'good';
      case 'ref':
      case 'ref_or_null':
      case 'fulltext':
      case 'index_merge':
        return 'ok';
      case 'range':
      case 'index':
        return 'warn';
      case 'ALL':
        return 'bad';
      default:
        return 'ok';
    }
  }
}
