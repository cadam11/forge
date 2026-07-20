import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
  effect,
  computed,
  inject,
  runInInjectionContext,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { firstValueFrom, Subscription } from 'rxjs';
import { IpcService } from '../../core/services/ipc.service';
import { ConnectionStateService } from '../../core/state/connection.state';
import { keyHint } from '../../core/utils/platform';
import { TabStateService } from '../../core/state/tab.state';
import { NotificationService } from '../../core/services/notification.service';
import { QueryHistoryStateService } from '../../core/state/query-history.state';
import { QueryResultsStateService } from '../../core/state/query-results.state';
import { AIStateService } from '../../core/state/ai.state';
import { QueryExecutionService } from '../../core/services/query-execution.service';
import { SettingsService } from '../../core/services/settings.service';
import { MenuService } from '../../core/services/menu.service';
import { SqlIntellisenseService } from '../../core/services/sql-intellisense.service';
import { ResultsGridComponent } from '../../shared/components/results-grid/results-grid.component';
import {
  RowDetailPanelComponent,
  RowDetailData,
} from '../../shared/components/row-detail-panel/row-detail-panel.component';
import { ResultHistoryPanelComponent } from '../../shared/components/result-history-panel/result-history-panel.component';
import { AIAnalysisPanelComponent } from '../../shared/components/ai-analysis-panel/ai-analysis-panel.component';
import { ExecutionPlanComponent } from '../../shared/components/execution-plan/execution-plan.component';
import { ConnectionContextChipComponent } from '../../shared/components/connection-context-chip/connection-context-chip.component';
import type {
  QueryResult,
  ResultSet,
  QueryHistoryEntry,
  ExportFormat,
  QueryResultSnapshot,
} from '@mj-forge/shared';
import { format as formatSQL } from 'sql-formatter';

// Monaco editor types - loaded dynamically
interface MonacoEditor {
  create(element: HTMLElement, options: Record<string, unknown>): MonacoEditorInstance;
}

interface MonacoEditorInstance {
  getValue(): string;
  setValue(value: string): void;
  getSelection(): MonacoSelection | null;
  getModel(): MonacoModel | null;
  onDidChangeModelContent(callback: () => void): void;
  dispose(): void;
  focus(): void;
  getAction(actionId: string): MonacoAction | null;
  trigger(source: string, handlerId: string, payload?: unknown): void;
  getPosition(): MonacoPosition | null;
  setPosition(position: MonacoPosition): void;
  revealLineInCenter(lineNumber: number): void;
  updateOptions(options: Record<string, unknown>): void;
  onDidChangeCursorPosition(callback: (e: { position: MonacoPosition }) => void): {
    dispose(): void;
  };
  onKeyDown(
    callback: (e: {
      browserEvent: KeyboardEvent;
      preventDefault(): void;
      stopPropagation(): void;
    }) => void
  ): { dispose(): void };
  addCommand(keybinding: number, handler: () => void): void;
}

interface MonacoAction {
  run(): Promise<void>;
}

interface MonacoPosition {
  lineNumber: number;
  column: number;
}

interface MonacoSelection {
  isEmpty(): boolean;
}

interface MonacoModel {
  getValueInRange(selection: MonacoSelection): string;
  getLineCount(): number;
  getLineContent(lineNumber: number): string;
}

declare const monaco: {
  KeyMod: { CtrlCmd: number; Shift: number; Alt: number; WinCtrl: number };
  KeyCode: { KeyE: number; [key: string]: number };
  editor: MonacoEditor & {
    setTheme(themeName: string): void;
  };
  languages: {
    registerCompletionItemProvider(
      languageId: string,
      provider: {
        provideCompletionItems: (
          model: unknown,
          position: unknown
        ) => {
          suggestions: Array<{
            label: string;
            kind: number;
            insertText: string;
            detail: string;
          }>;
        };
      }
    ): void;
    CompletionItemKind: {
      Struct: number;
      Interface: number;
      Function: number;
      Field: number;
      Keyword: number;
    };
  };
};

@Component({
  selector: 'app-query',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatInputModule,
    MatDividerModule,
    ResultsGridComponent,
    RowDetailPanelComponent,
    ResultHistoryPanelComponent,
    AIAnalysisPanelComponent,
    ExecutionPlanComponent,
    ConnectionContextChipComponent,
  ],
  template: `
    <div class="query-container">
      <!-- Toolbar -->
      <div class="query-toolbar" role="toolbar" aria-label="Query actions">
        <button
          mat-icon-button
          [matTooltip]="'Execute (F5 or ' + executeKeyHint + ')'"
          aria-label="Execute query"
          [disabled]="executing()"
          (click)="executeQuery()"
        >
          @if (executing()) {
            <mat-spinner diameter="18" />
          } @else {
            <mat-icon>play_arrow</mat-icon>
          }
        </button>
        <button
          mat-icon-button
          matTooltip="Cancel"
          aria-label="Cancel query"
          [disabled]="!executing()"
          (click)="cancelQuery()"
        >
          <mat-icon>stop</mat-icon>
        </button>
        <div class="toolbar-divider"></div>

        <app-connection-context-chip
          [connectionId]="tabConnectionId()"
          [databaseName]="selectedDatabase"
          (connectionChanged)="onConnectionChange($event)"
          (databaseChanged)="onDatabaseChange($event)"
        />

        <div class="toolbar-spacer"></div>

        <button
          mat-icon-button
          matTooltip="Query History"
          aria-label="Query History"
          (click)="toggleHistory()"
        >
          <mat-icon>history</mat-icon>
        </button>
        <button mat-icon-button matTooltip="Find (⌘F)" aria-label="Find" (click)="openFind()">
          <mat-icon>search</mat-icon>
        </button>
        <button
          mat-icon-button
          matTooltip="Find & Replace (⌘⌥F)"
          aria-label="Find and Replace"
          (click)="openFindReplace()"
        >
          <mat-icon>find_replace</mat-icon>
        </button>
        <button
          mat-icon-button
          matTooltip="Go to Line (⌘G)"
          aria-label="Go to Line"
          (click)="goToLine()"
        >
          <mat-icon>format_list_numbered</mat-icon>
        </button>
        <div class="toolbar-divider"></div>
        <button
          mat-icon-button
          matTooltip="Format SQL (⌘⇧F)"
          aria-label="Format SQL"
          (click)="formatSql()"
        >
          <mat-icon>auto_fix_high</mat-icon>
        </button>
        <button
          mat-icon-button
          matTooltip="Show Execution Plan"
          aria-label="Show Execution Plan"
          (click)="showExecutionPlan()"
        >
          <mat-icon>account_tree</mat-icon>
        </button>
        <button mat-icon-button [matMenuTriggerFor]="convertMenu" matTooltip="Convert SQL Dialect">
          <mat-icon>translate</mat-icon>
        </button>
        <mat-menu #convertMenu="matMenu">
          @if (tabProfile()?.engine !== 'mssql') {
            <button mat-menu-item (click)="convertSqlTo('mssql')">
              <mat-icon>dns</mat-icon> To SQL Server
            </button>
          }
          @if (tabProfile()?.engine !== 'postgresql') {
            <button mat-menu-item (click)="convertSqlTo('postgresql')">
              <mat-icon>view_cozy</mat-icon> To PostgreSQL
            </button>
          }
          @if (tabProfile()?.engine !== 'mysql') {
            <button mat-menu-item (click)="convertSqlTo('mysql')">
              <mat-icon>grid_on</mat-icon> To MySQL
            </button>
          }
        </mat-menu>

        @if (activeResultSet()) {
          <div class="toolbar-divider"></div>
          <button
            mat-icon-button
            matTooltip="Copy All to Clipboard (Tab-separated)"
            (click)="copyResultsToClipboard()"
          >
            <mat-icon>content_copy</mat-icon>
          </button>
          <button mat-icon-button [matMenuTriggerFor]="exportMenu" matTooltip="Export Results">
            <mat-icon>download</mat-icon>
          </button>
          <mat-menu #exportMenu="matMenu">
            <button mat-menu-item (click)="exportResults('csv')">
              <mat-icon>description</mat-icon>
              <span>Export as CSV</span>
            </button>
            <button mat-menu-item (click)="exportResults('json')">
              <mat-icon>code</mat-icon>
              <span>Export as JSON</span>
            </button>
            <button mat-menu-item (click)="exportResults('sql')">
              <mat-icon>storage</mat-icon>
              <span>Export as SQL INSERT</span>
            </button>
            <mat-divider></mat-divider>
            <button mat-menu-item (click)="copyResultsToClipboard(false)">
              <mat-icon>content_copy</mat-icon>
              <span>Copy to Clipboard</span>
            </button>
            <button mat-menu-item (click)="copyResultsToClipboard(true)">
              <mat-icon>table_chart</mat-icon>
              <span>Copy with Headers</span>
            </button>
          </mat-menu>
        }
      </div>

      <!-- Main content area -->
      <div class="query-main">
        <!-- History panel (collapsible sidebar) -->
        @if (showHistory()) {
          <div class="history-panel">
            <div class="history-header">
              <h3>Query History</h3>
              <button mat-icon-button (click)="toggleHistory()" matTooltip="Close">
                <mat-icon>close</mat-icon>
              </button>
            </div>

            <div class="history-search">
              <mat-form-field appearance="outline" class="history-search-field">
                <mat-icon matTextPrefix>search</mat-icon>
                <input
                  matInput
                  placeholder="Search history..."
                  [(ngModel)]="historySearchText"
                  (input)="onHistorySearch()"
                />
              </mat-form-field>
            </div>

            <div class="history-list">
              @if (historyState.loading()) {
                <div class="history-loading">
                  <mat-spinner diameter="24" />
                </div>
              } @else if (historyState.entries().length === 0) {
                <div class="history-empty">
                  <mat-icon>history</mat-icon>
                  <p>No queries in history</p>
                </div>
              } @else {
                @for (entry of historyState.entries(); track entry.id) {
                  <div
                    class="history-entry"
                    [class.error]="!entry.success"
                    (click)="loadFromHistory(entry)"
                  >
                    <div class="history-entry-header">
                      <span class="history-db">{{ entry.database }}</span>
                      <span class="history-time">{{ formatHistoryTime(entry.executedAt) }}</span>
                    </div>
                    <pre class="history-sql">{{ truncateSql(entry.sql) }}</pre>
                    <div class="history-entry-footer">
                      @if (entry.success) {
                        <span class="history-rows">{{ entry.rowCount || 0 }} rows</span>
                      } @else {
                        <span class="history-error">Error</span>
                      }
                      <span class="history-duration">{{ entry.executionTimeMs }}ms</span>
                    </div>
                  </div>
                }
              }
            </div>

            @if (historyState.count() > 0) {
              <div class="history-footer">
                <button mat-button color="warn" (click)="clearHistory()">
                  <mat-icon>delete_sweep</mat-icon>
                  Clear History
                </button>
              </div>
            }
          </div>
        }

        <!-- Editor and Results -->
        <div class="query-content">
          <!-- Editor -->
          <div class="editor-pane" [style.height.%]="resultsHidden() ? 100 : editorHeight()">
            <div #editorContainer class="editor-container"></div>
          </div>

          @if (!resultsHidden()) {
            <!-- Resize handle -->
            <div class="resize-handle" (mousedown)="startResize($event)"></div>

            <!-- Results -->
            <div class="results-pane">
              @if (!result()) {
                <div class="results-placeholder">
                  <mat-icon>terminal</mat-icon>
                  <p>Execute a query to see results</p>
                  <p class="hint">Press F5 or click the play button</p>
                </div>
              } @else if (result()?.error) {
                <div class="results-error">
                  <mat-icon>error</mat-icon>
                  <div class="error-content">
                    <h4>Error</h4>
                    <pre>{{ result()?.error }}</pre>
                  </div>
                </div>
              } @else {
                <div class="results-tabs">
                  <div class="tabs-left">
                    @for (resultSet of result()?.resultSets; track $index; let i = $index) {
                      <button
                        class="result-tab"
                        [class.active]="activeTab() === 'result-' + i"
                        (click)="setActiveTab('result-' + i)"
                      >
                        Result {{ i + 1 }}
                        <span class="row-count">({{ resultSet.rows.length }} rows)</span>
                      </button>
                    }
                    <button
                      class="result-tab"
                      [class.active]="activeTab() === 'messages'"
                      (click)="setActiveTab('messages')"
                    >
                      Messages
                    </button>
                  </div>
                  <div class="tabs-right">
                    @if (planData()) {
                      <button
                        class="result-tab icon-tab"
                        [class.active]="activeTab() === 'plan'"
                        (click)="setActiveTab('plan')"
                        matTooltip="Execution Plan"
                      >
                        <mat-icon>account_tree</mat-icon>
                      </button>
                    }
                    @if (aiState.analysisEnabled()) {
                      <button
                        class="result-tab icon-tab"
                        [class.active]="activeTab() === 'ai'"
                        (click)="setActiveTab('ai')"
                        matTooltip="AI Analysis"
                      >
                        <mat-icon>auto_awesome</mat-icon>
                      </button>
                    }
                    @if (tabId) {
                      <button
                        class="result-tab icon-tab"
                        [class.active]="activeTab() === 'history'"
                        (click)="setActiveTab('history')"
                        matTooltip="Result History"
                      >
                        <mat-icon>history</mat-icon>
                        @if (resultsState.snapshots().length > 0) {
                          <span class="tab-badge">{{ resultsState.snapshots().length }}</span>
                        }
                      </button>
                    }
                  </div>
                </div>

                @if (activeTab().startsWith('result-') && activeResultSet()) {
                  <div class="results-grid">
                    <!-- Historical Result Banner -->
                    @if (viewingHistoricalResult()) {
                      <div class="historical-banner">
                        <mat-icon>history</mat-icon>
                        <div class="banner-content">
                          <span class="banner-label">Viewing Historical Result</span>
                          <span class="banner-date">{{
                            formatHistoricalDate(viewingHistoricalResult()!)
                          }}</span>
                        </div>
                        <button
                          mat-icon-button
                          matTooltip="Return to current result"
                          (click)="clearHistoricalResult()"
                        >
                          <mat-icon>close</mat-icon>
                        </button>
                      </div>
                    }
                    <app-results-grid
                      [resultSet]="activeResultSet()"
                      [connectionId]="tabConnectionId()"
                      [database]="selectedDatabase"
                      [class.historical]="viewingHistoricalResult()"
                      (cellSelected)="onCellSelected($event)"
                      (exportRequested)="exportResults($event)"
                      (openQueryRequested)="openQueryInNewTab($event)"
                    />
                  </div>
                } @else if (activeTab() === 'messages') {
                  <div class="messages-pane">
                    <pre>{{
                      result()?.messages?.join('\\n') || 'Query executed successfully.'
                    }}</pre>
                    @if (result()?.rowsAffected !== undefined) {
                      <p class="rows-affected">({{ result()?.rowsAffected }} rows affected)</p>
                    }
                    <p class="execution-time">Execution time: {{ result()?.executionTime }}ms</p>
                  </div>
                } @else if (activeTab() === 'ai') {
                  <div class="tab-content-pane">
                    <app-ai-analysis-panel
                      [sql]="getLastExecutedSql()"
                      [resultSet]="getFirstResultSet()"
                      [databaseName]="selectedDatabase ?? ''"
                      [embedded]="true"
                    />
                  </div>
                } @else if (activeTab() === 'history' && tabId) {
                  <div class="tab-content-pane">
                    <app-result-history-panel
                      [tabId]="tabId"
                      [connectionId]="tabConnectionId() ?? undefined"
                      [database]="selectedDatabase ?? undefined"
                      [embedded]="true"
                      (viewResult)="onViewHistoryResult($event)"
                      (compareResults)="onCompareResults($event)"
                    />
                  </div>
                } @else if (activeTab() === 'plan' && planData()) {
                  <div class="tab-content-pane">
                    <app-execution-plan
                      [planData]="planData()"
                      [engine]="planEngine()"
                      [mysqlExplainUrl]="planMysqlExplainUrl()"
                    />
                  </div>
                }
              }
            </div>
          }
        </div>
      </div>

      <!-- Row Detail Panel -->
      <app-row-detail-panel
        [inputData]="rowDetailData()"
        [totalRows]="rowDetailTotalRows()"
        [connectionId]="tabConnectionId()"
        [database]="selectedDatabase"
        (closed)="closeRowDetail()"
        (navigateRow)="navigateRowDetail($event)"
        (openQueryRequested)="openQueryInNewTab($event)"
      />
    </div>
  `,
  styles: [
    `
      .query-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .query-toolbar {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);
      }

      .toolbar-divider {
        width: 1px;
        height: 24px;
        background-color: var(--border-primary);
        margin: 0 var(--spacing-xs);
      }

      .toolbar-spacer {
        flex: 1;
      }

      .query-main {
        flex: 1;
        display: flex;
        overflow: hidden;
      }

      .history-panel {
        width: 320px;
        border-right: 1px solid var(--border-primary);
        display: flex;
        flex-direction: column;
        background-color: var(--bg-secondary);
      }

      .history-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);

        h3 {
          margin: 0;
          font-size: var(--font-size-md);
          font-weight: 600;
        }
      }

      .history-search {
        padding: var(--spacing-sm);
        border-bottom: 1px solid var(--border-primary);
      }

      .history-search-field {
        width: 100%;

        ::ng-deep .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }
      }

      .history-list {
        flex: 1;
        overflow-y: auto;
      }

      .history-loading,
      .history-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-xl);
        color: var(--text-muted);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          opacity: 0.5;
          margin-bottom: var(--spacing-sm);
        }

        p {
          margin: 0;
        }
      }

      .history-entry {
        padding: var(--spacing-sm) var(--spacing-md);
        border-bottom: 1px solid var(--border-primary);
        cursor: pointer;
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        &.error {
          border-left: 3px solid var(--status-error);
        }
      }

      .history-entry-header {
        display: flex;
        justify-content: space-between;
        margin-bottom: var(--spacing-xs);
        font-size: var(--font-size-xs);
      }

      .history-db {
        color: var(--text-primary);
        font-weight: 500;
      }

      .history-time {
        color: var(--text-muted);
      }

      .history-sql {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--font-size-xs);
        color: var(--text-secondary);
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 60px;
        overflow: hidden;
      }

      .history-entry-footer {
        display: flex;
        justify-content: space-between;
        margin-top: var(--spacing-xs);
        font-size: var(--font-size-xs);
        color: var(--text-muted);
      }

      .history-error {
        color: var(--status-error);
      }

      .history-footer {
        padding: var(--spacing-sm);
        border-top: 1px solid var(--border-primary);
        text-align: center;
      }

      .query-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .editor-pane {
        min-height: 100px;
        overflow: hidden;
      }

      .editor-container {
        width: 100%;
        height: 100%;
      }

      .resize-handle {
        height: 4px;
        background-color: var(--border-primary);
        cursor: row-resize;
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--border-focus);
        }
      }

      .results-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-height: 100px;
      }

      .results-placeholder {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);

        mat-icon {
          font-size: 48px;
          width: 48px;
          height: 48px;
          opacity: 0.5;
          margin-bottom: var(--spacing-md);
        }

        p {
          margin: 0;
        }

        .hint {
          font-size: var(--font-size-sm);
          margin-top: var(--spacing-xs);
        }
      }

      .results-error {
        display: flex;
        gap: var(--spacing-md);
        padding: var(--spacing-md);
        background-color: rgba(244, 67, 54, 0.1);
        border-left: 3px solid var(--status-error);
        margin: var(--spacing-md);

        mat-icon {
          color: var(--status-error);
        }

        .error-content {
          flex: 1;

          h4 {
            margin: 0 0 var(--spacing-xs);
            color: var(--status-error);
          }

          pre {
            margin: 0;
            font-family: var(--font-mono);
            font-size: var(--font-size-sm);
            white-space: pre-wrap;
            color: var(--text-primary);
          }
        }
      }

      .results-tabs {
        display: flex;
        justify-content: space-between;
        background-color: var(--border-primary);
        border-bottom: 1px solid var(--border-primary);
      }

      .tabs-left,
      .tabs-right {
        display: flex;
        gap: 1px;
      }

      .result-tab {
        padding: var(--spacing-xs) var(--spacing-md);
        background-color: var(--bg-secondary);
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        font-size: var(--font-size-sm);
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }

        &.active {
          background-color: var(--bg-primary);
          color: var(--text-primary);
        }

        &.icon-tab {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-xs) var(--spacing-sm);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }
        }

        .row-count {
          color: var(--text-muted);
          margin-left: var(--spacing-xs);
        }

        .tab-badge {
          background-color: var(--accent-primary);
          color: white;
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 8px;
          min-width: 14px;
          text-align: center;
        }
      }

      .tab-content-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: auto;
        min-height: 0;
      }

      .results-grid {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .historical-banner {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-xs) var(--spacing-md);
        background: linear-gradient(90deg, rgba(156, 39, 176, 0.15), rgba(103, 58, 183, 0.15));
        border-bottom: 2px solid rgba(156, 39, 176, 0.5);
        color: var(--text-primary);

        > mat-icon {
          color: #9c27b0;
          font-size: 18px;
          width: 18px;
          height: 18px;
        }

        .banner-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .banner-label {
          font-size: var(--font-size-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #9c27b0;
        }

        .banner-date {
          font-size: var(--font-size-sm);
          color: var(--text-secondary);
        }

        button {
          width: 24px;
          height: 24px;

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
          }
        }
      }

      app-results-grid.historical {
        border-left: 3px solid rgba(156, 39, 176, 0.5);
      }

      .messages-pane {
        flex: 1;
        padding: var(--spacing-md);
        font-family: var(--font-mono);
        font-size: var(--font-size-sm);
        overflow: auto;

        pre {
          margin: 0;
          white-space: pre-wrap;
        }

        .rows-affected,
        .execution-time {
          margin: var(--spacing-sm) 0 0;
          color: var(--text-secondary);
        }
      }
    `,
  ],
})
export class QueryComponent implements OnInit, OnDestroy {
  @ViewChild('editorContainer', { static: true })
  editorContainer!: ElementRef<HTMLDivElement>;

  // Source of truth for displayed (post-sort/filter) row order in the drawer.
  @ViewChild(ResultsGridComponent)
  resultsGrid?: ResultsGridComponent;

  private readonly ipc = inject(IpcService);
  readonly connectionState = inject(ConnectionStateService);
  readonly tabState = inject(TabStateService);
  private readonly notification = inject(NotificationService);
  readonly historyState = inject(QueryHistoryStateService);
  readonly resultsState = inject(QueryResultsStateService);
  readonly aiState = inject(AIStateService);
  private readonly queryExecution = inject(QueryExecutionService);
  private readonly settings = inject(SettingsService);
  private readonly menuService = inject(MenuService);
  private readonly intellisense = inject(SqlIntellisenseService);
  private readonly injector = inject(Injector);

  private editor?: MonacoEditorInstance;
  private resizing = false;
  private menuSubscriptions: Subscription[] = [];

  /**
   * The tab ID this component instance is bound to.
   * Set by GoldenLayoutContainer when creating the component.
   * This is the KEY to tab isolation - each component only manages its own tab.
   */
  tabId: string | null = null;

  readonly tabConnectionId = computed(() => {
    const tab = this.tabState.tabs().find(t => t.id === this.tabId);
    return tab?.connectionId ?? this.connectionState.focusedConnectionId();
  });

  readonly tabProfile = computed(() => this.connectionState.profileFor(this.tabConnectionId()));

  selectedDatabase: string | null = null;
  executing = signal(false);
  readonly executeKeyHint = keyHint('E');
  result = signal<QueryResult | null>(null);
  activeTab = signal('result-0');
  editorHeight = signal(50);
  resultsHidden = signal(false);
  showHistory = signal(false);
  historySearchText = '';

  readonly autoCompleteObjects = signal<
    Array<{ name: string; schema: string; type: string; displayType: string }>
  >([]);

  // Row detail panel state
  rowDetailData = signal<RowDetailData | null>(null);
  showRowDetail = signal(false);
  // Displayed row count captured when the drawer opens/navigates, so the
  // panel's Next/Previous bounds match the sorted/filtered view.
  rowDetailTotalRows = signal(0);

  // Execution plan state
  planData = signal<unknown>(null);
  planEngine = signal<import('@mj-forge/shared').DatabaseEngine>('mssql');
  planMysqlExplainUrl = signal<string | null>(null);

  // Track last executed SQL for AI analysis
  private lastExecutedSql = '';

  // Track when viewing historical results (not the current execution)
  viewingHistoricalResult = signal<QueryResultSnapshot | null>(null);

  private currentQueryId: string | null = null;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private editorReadyTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeCleanup: (() => void) | null = null;

  constructor() {
    // Watch for THIS component's tab becoming active to sync editor content
    effect(
      () => {
        const activeTab = this.tabState.activeTab();
        // Only act if this component's tab is now active
        if (activeTab?.type === 'query' && this.tabId && activeTab.id === this.tabId) {
          // Sync local database selection from tab state
          if (activeTab.databaseName) {
            this.selectedDatabase = activeTab.databaseName;
          }

          // Update editor content when it's ready
          if (this.editor && activeTab.content !== undefined) {
            const currentValue = this.editor.getValue();
            // Only update if content differs (prevents cursor jump).
            // Never overwrite non-empty editor with empty content — the editor
            // is the source of truth; tab state may lag behind during execution.
            if (currentValue !== activeTab.content && (activeTab.content || !currentValue)) {
              this.editor.setValue(activeTab.content || '');
            }
          }

          // Auto-execute if flag is set
          if (activeTab.autoExecute && activeTab.content) {
            // Clear the flag first to prevent re-execution
            this.tabState.clearAutoExecute(activeTab.id);
            // Execute after editor is ready with content
            this.executeWhenEditorReady(activeTab.content);
          }
        }
      },
      { allowSignalWrites: true }
    );

    // Watch for theme changes and update Monaco editor theme accordingly
    effect(() => {
      const theme = this.settings.effectiveTheme();
      if (typeof monaco !== 'undefined') {
        monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
      }
    });

    // Tabs own their own database selection — no global sync needed.
  }

  ngOnInit(): void {
    this.initMonaco();
    // Initialize database from this tab's bound (connectionId, databaseName).
    // The tab carries the authoritative pair; only fall back to focused-tab
    // state if the binding is somehow missing.
    const tab = this.tabState.tabs().find(t => t.id === this.tabId);
    const focusId = this.connectionState.focusedConnectionId();
    this.selectedDatabase = tab?.databaseName ?? this.connectionState.selectedDatabaseFor(focusId);

    // Listen for keyboard shortcuts
    document.addEventListener('keydown', this.handleKeydown);
    // Listen for snippet insertion events
    window.addEventListener('forge:insert-snippet', this.handleInsertSnippet);

    // Subscribe to menu service events (only act when THIS tab is active)
    const guard = (fn: () => void) => () => {
      const active = this.tabState.activeTab();
      if (this.tabId && active?.id === this.tabId) fn();
    };

    this.menuSubscriptions.push(
      this.menuService.executeQuery$.subscribe(guard(() => this.executeQuery())),
      this.menuService.executeSelection$.subscribe(guard(() => this.executeQuery())),
      this.menuService.cancelQuery$.subscribe(guard(() => this.cancelQuery())),
      this.menuService.find$.subscribe(guard(() => this.openFind())),
      this.menuService.replace$.subscribe(guard(() => this.openFindReplace())),
      this.menuService.formatSql$.subscribe(guard(() => this.formatSql())),
      this.menuService.toggleComment$.subscribe(guard(() => this.toggleComment())),
      this.menuService.closeTab$.subscribe(guard(() => this.tabState.closeTab(this.tabId!))),
      this.menuService.saveQuery$.subscribe(guard(() => this.saveQueryToFile())),
      this.menuService.saveQueryAs$.subscribe(guard(() => this.saveQueryToFile())),
      this.menuService.exportResults$.subscribe(guard(() => this.exportResults('csv'))),
      this.menuService.openQuery$.subscribe(guard(() => this.openQueryFromFile())),
      this.menuService.toggleResults$.subscribe(guard(() => this.resultsHidden.update(h => !h)))
    );
  }

  ngOnDestroy(): void {
    this.editor?.dispose();
    document.removeEventListener('keydown', this.handleKeydown);
    window.removeEventListener('forge:insert-snippet', this.handleInsertSnippet);
    this.menuSubscriptions.forEach(s => s.unsubscribe());
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    if (this.editorReadyTimer) {
      clearTimeout(this.editorReadyTimer);
    }
    this.resizeCleanup?.();
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    // Only respond to shortcuts if THIS component's tab is active
    const activeTab = this.tabState.activeTab();
    if (!this.tabId || activeTab?.id !== this.tabId) {
      return;
    }

    // F5 - Execute query
    if (event.key === 'F5') {
      event.preventDefault();
      this.executeQuery();
      return;
    }
    // Cmd+Shift+F - Format SQL
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.formatSql();
      return;
    }
    // Cmd+Enter - Execute query (alternative)
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      this.executeQuery();
      return;
    }
    // Ctrl+E / Cmd+E - Execute query (SSMS-style shortcut)
    // When the Monaco editor is focused, its addCommand handles this;
    // only handle here when the editor is NOT focused to avoid double-fire.
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'e') {
      const editorEl = this.editorContainer?.nativeElement;
      if (!editorEl || !editorEl.contains(event.target as Node)) {
        event.preventDefault();
        this.handleCtrlEExecute();
      }
      return;
    }
    // Cmd+G / Ctrl+G - Go to Line
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      this.goToLine();
      return;
    }
    // Cmd+Option+F / Ctrl+Alt+F - Find & Replace (standard macOS shortcut)
    if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      this.openFindReplace();
      return;
    }
  };

  private handleInsertSnippet = (event: Event): void => {
    // Only respond if THIS component's tab is active
    const activeTab = this.tabState.activeTab();
    if (!this.tabId || activeTab?.id !== this.tabId) {
      return;
    }

    const customEvent = event as CustomEvent<{ sql: string }>;
    const sql = customEvent.detail?.sql;
    if (sql && this.editor) {
      const currentValue = this.editor.getValue();
      if (currentValue.trim()) {
        // Append with newline separator
        this.editor.setValue(currentValue + '\n\n' + sql);
      } else {
        this.editor.setValue(sql);
      }
      this.notification.success('Snippet inserted');
    }
  };

  private initMonaco(): void {
    // Monaco loader - use singleton pattern to prevent duplicate loading
    const win = window as unknown as {
      _monacoLoading?: Promise<void>;
      _monacoLoaded?: boolean;
      require?: {
        config: (config: Record<string, unknown>) => void;
        (modules: string[], callback: () => void): void;
      };
    };

    // If Monaco is already loaded, create editor immediately
    if (typeof monaco !== 'undefined' || win._monacoLoaded) {
      this.createEditor();
      return;
    }

    // If Monaco is currently loading, wait for it
    if (win._monacoLoading) {
      win._monacoLoading.then(() => this.createEditor());
      return;
    }

    // Start loading Monaco (singleton)
    win._monacoLoading = new Promise<void>(resolve => {
      // Check if loader script already exists
      const existingScript = document.querySelector('script[src*="monaco/vs/loader.js"]');
      if (existingScript) {
        // Loader exists but may still be loading - check if require is available
        const checkRequire = () => {
          if (win.require) {
            win.require.config({ paths: { vs: 'assets/monaco/vs' } });
            win.require(['vs/editor/editor.main'], () => {
              win._monacoLoaded = true;
              resolve();
            });
          } else {
            setTimeout(checkRequire, 50);
          }
        };
        checkRequire();
        return;
      }

      // Dynamically load Monaco from assets
      const script = document.createElement('script');
      script.src = 'assets/monaco/vs/loader.js';
      script.onload = () => {
        if (win.require) {
          win.require.config({ paths: { vs: 'assets/monaco/vs' } });
          win.require(['vs/editor/editor.main'], () => {
            win._monacoLoaded = true;
            resolve();
          });
        }
      };
      document.body.appendChild(script);
    });

    win._monacoLoading.then(() => this.createEditor());
  }

  /** Get the Monaco language ID based on the active connection's database engine */
  private getEditorLanguage(): string {
    const engine = this.tabProfile()?.engine;
    if (engine === 'postgresql') return 'pgsql';
    if (engine === 'mysql') return 'mysql';
    return 'sql'; // T-SQL / default
  }

  private createEditor(): void {
    this.editor = monaco.editor.create(this.editorContainer.nativeElement, {
      value: '',
      language: this.getEditorLanguage(),
      theme: this.settings.effectiveTheme() === 'dark' ? 'vs-dark' : 'vs',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      insertSpaces: true,
      renderWhitespace: 'selection',
      // Find widget configuration
      find: {
        addExtraSpaceOnTop: true,
        autoFindInSelection: 'multiline',
        seedSearchStringFromSelection: 'selection',
        loop: true,
      },
      // Enable selection highlighting (highlights all occurrences of selected text)
      occurrencesHighlight: 'singleFile',
      selectionHighlight: true,
    });

    // Override Monaco's Ctrl+E / Cmd+E (normally "Expand Line Selection")
    // to fire Execute Query instead, matching SSMS behavior
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, () =>
      this.handleCtrlEExecute()
    );

    // Emit cursor position changes for status bar
    this.editor.onDidChangeCursorPosition((e: { position: MonacoPosition }) => {
      window.dispatchEvent(
        new CustomEvent('forge:cursor-position', {
          detail: { line: e.position.lineNumber, column: e.position.column },
        })
      );
    });

    // Cmd+Enter / Ctrl+Enter — execute query (intercept before Monaco inserts newline)
    this.editor.onKeyDown(e => {
      if ((e.browserEvent.metaKey || e.browserEvent.ctrlKey) && e.browserEvent.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.executeQuery();
      }
    });

    // Update editor language when connection engine changes
    runInInjectionContext(this.injector, () => {
      effect(() => {
        const lang = this.getEditorLanguage();
        const model = this.editor?.getModel();
        if (model) {
          (
            monaco.editor as unknown as { setModelLanguage(m: unknown, l: string): void }
          ).setModelLanguage(model, lang);
        }
      });
    });

    // Listen for content changes - use this.tabId for isolation
    this.editor.onDidChangeModelContent(() => {
      const content = this.editor?.getValue() || '';
      // Use the fixed tabId this component was created for
      // This prevents writes to wrong tabs when switching quickly
      if (this.tabId) {
        this.tabState.setTabContent(this.tabId, content);
      }
    });

    // Load existing content from this component's tab
    if (this.tabId) {
      const tab = this.tabState.tabs().find(t => t.id === this.tabId);
      if (tab?.type === 'query') {
        if (tab.content) {
          this.editor.setValue(tab.content);
        }
        // Ensure a clean baseline exists for this tab
        if (!this.tabState.getCleanBaseline(this.tabId!)) {
          this.tabState.setCleanBaseline(this.tabId!, tab.content ?? '');
        }
        // Handle auto-execute for initial load
        if (tab.autoExecute && tab.content) {
          this.tabState.clearAutoExecute(tab.id);
          // Sync database from tab before executing — the effect may not have fired yet
          if (tab.databaseName && tab.connectionId) {
            this.selectedDatabase = tab.databaseName;
            this.connectionState.selectDatabase(tab.connectionId, tab.databaseName);
          }
          this.executeQuery();
        }
      }
    } else {
      // Fallback for components created without tabId (legacy path)
      const activeTab = this.tabState.activeTab();
      if (activeTab?.type === 'query') {
        this.tabId = activeTab.id; // Capture the tab ID
        if (activeTab.content) {
          this.editor.setValue(activeTab.content);
        }
        // Set clean baseline for fallback path
        this.tabState.setCleanBaseline(activeTab.id, activeTab.content ?? '');
        if (activeTab.autoExecute && activeTab.content) {
          this.tabState.clearAutoExecute(activeTab.id);
          if (activeTab.databaseName && activeTab.connectionId) {
            this.selectedDatabase = activeTab.databaseName;
            this.connectionState.selectDatabase(activeTab.connectionId, activeTab.databaseName);
          }
          this.executeQuery();
        }
      }
    }

    // Register SQL auto-complete provider
    monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (_model: unknown, _position: unknown) => {
        const suggestions: Array<{
          label: string;
          kind: number;
          insertText: string;
          detail: string;
        }> = [];

        // Add table suggestions from cached metadata
        for (const obj of this.autoCompleteObjects()) {
          suggestions.push({
            label: obj.schema === 'dbo' ? obj.name : `${obj.schema}.${obj.name}`,
            kind:
              obj.type === 'table'
                ? monaco.languages.CompletionItemKind.Struct
                : obj.type === 'view'
                  ? monaco.languages.CompletionItemKind.Interface
                  : obj.type === 'procedure'
                    ? monaco.languages.CompletionItemKind.Function
                    : monaco.languages.CompletionItemKind.Field,
            insertText: obj.schema === 'dbo' ? `[${obj.name}]` : `[${obj.schema}].[${obj.name}]`,
            detail: `${obj.displayType} - ${obj.schema}`,
          });
        }

        // Add SQL keywords
        const keywords = [
          'SELECT',
          'FROM',
          'WHERE',
          'JOIN',
          'LEFT',
          'RIGHT',
          'INNER',
          'OUTER',
          'ON',
          'AND',
          'OR',
          'NOT',
          'IN',
          'EXISTS',
          'BETWEEN',
          'LIKE',
          'ORDER BY',
          'GROUP BY',
          'HAVING',
          'INSERT',
          'INTO',
          'VALUES',
          'UPDATE',
          'SET',
          'DELETE',
          'CREATE',
          'ALTER',
          'DROP',
          'TABLE',
          'VIEW',
          'INDEX',
          'EXEC',
          'EXECUTE',
          'DECLARE',
          'BEGIN',
          'END',
          'IF',
          'ELSE',
          'WHILE',
          'RETURN',
          'TOP',
          'DISTINCT',
          'AS',
          'NULL',
          'IS',
          'NOT NULL',
          'COUNT',
          'SUM',
          'AVG',
          'MIN',
          'MAX',
          'CAST',
          'CONVERT',
          'COALESCE',
          'ISNULL',
        ];
        for (const kw of keywords) {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            detail: 'SQL Keyword',
          });
        }

        return { suggestions };
      },
    });

    this.loadAutoCompleteObjects();

    // Register AI ghost text provider (Tier 2 autocomplete)
    this.intellisense.registerGhostTextProvider(monaco);
  }

  private async loadAutoCompleteObjects(): Promise<void> {
    const connectionId = this.tabConnectionId();
    const database = this.selectedDatabase;
    if (!connectionId || !database) return;

    try {
      const [tables, views, procs] = await Promise.all([
        firstValueFrom(this.ipc.getExplorerChildren(connectionId, database, 'tables')),
        firstValueFrom(this.ipc.getExplorerChildren(connectionId, database, 'views')),
        firstValueFrom(this.ipc.getExplorerChildren(connectionId, database, 'procedures')),
      ]);

      const objects = [
        ...tables.map(t => ({
          name: t.name,
          schema: t.schema || 'dbo',
          type: 'table',
          displayType: 'Table',
        })),
        ...views.map(v => ({
          name: v.name,
          schema: v.schema || 'dbo',
          type: 'view',
          displayType: 'View',
        })),
        ...procs.map(p => ({
          name: p.name,
          schema: p.schema || 'dbo',
          type: 'procedure',
          displayType: 'Procedure',
        })),
      ];
      this.autoCompleteObjects.set(objects);
    } catch {
      // Silently fail - autocomplete is optional
    }
  }

  private static readonly CTRL_E_CONFIRMED_KEY = 'mj-forge-ctrl-e-execute-confirmed';
  private static readonly PLACEHOLDER_VALUES_KEY = 'mj-forge-flyway-placeholder-values';

  /**
   * Handle Ctrl+E / Cmd+E — shows a one-time confirmation dialog for new users,
   * then executes the query directly on subsequent uses.
   */
  private handleCtrlEExecute(): void {
    if (localStorage.getItem(QueryComponent.CTRL_E_CONFIRMED_KEY) === 'true') {
      this.executeQuery();
      return;
    }

    // Show first-time confirmation dialog
    this.showCtrlEConfirmDialog();
  }

  private showCtrlEConfirmDialog(): void {
    // Create a simple inline dialog
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const shortcutLabel = this.executeKeyHint;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: var(--bg-secondary); border-radius: 12px; border: 1px solid var(--border-primary);
      box-shadow: 0 8px 32px rgba(0,0,0,0.3); width: 420px; max-width: 90vw; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;
    dialog.innerHTML = `
      <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-primary); display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 20px;">⚡</span>
        <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary);">Execute Query?</h3>
      </div>
      <div style="padding: 20px;">
        <p style="margin: 0 0 16px 0; color: var(--text-secondary); line-height: 1.5; font-size: 13px;">
          <strong style="color: var(--text-primary);">${shortcutLabel}</strong> will execute the current query against the connected database. This matches the familiar SSMS shortcut.
        </p>
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--text-secondary); font-size: 13px;">
          <input type="checkbox" id="ctrl-e-dont-ask" style="cursor: pointer;" />
          Don't ask me again
        </label>
      </div>
      <div style="padding: 12px 20px; border-top: 1px solid var(--border-primary); background: var(--bg-tertiary); display: flex; justify-content: flex-end; gap: 8px; border-radius: 0 0 12px 12px;">
        <button id="ctrl-e-execute" style="
          padding: 6px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 13px; font-weight: 500;
          background: var(--status-info, #007acc); color: white;
        ">Execute</button>
        <button id="ctrl-e-cancel" style="
          padding: 6px 16px; border-radius: 6px; border: 1px solid var(--border-primary); cursor: pointer; font-size: 13px;
          background: transparent; color: var(--text-primary);
        ">Cancel</button>
      </div>
    `;
    overlay.appendChild(dialog);

    const cleanup = () => overlay.remove();

    overlay.addEventListener('click', e => {
      if (e.target === overlay) cleanup();
    });

    dialog.querySelector('#ctrl-e-cancel')!.addEventListener('click', cleanup);

    dialog.querySelector('#ctrl-e-execute')!.addEventListener('click', () => {
      const checkbox = dialog.querySelector('#ctrl-e-dont-ask') as HTMLInputElement;
      if (checkbox.checked) {
        localStorage.setItem(QueryComponent.CTRL_E_CONFIRMED_KEY, 'true');
      }
      cleanup();
      this.executeQuery();
    });

    // ESC to dismiss
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cleanup();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(overlay);

    // Focus the Execute button
    setTimeout(() => (dialog.querySelector('#ctrl-e-execute') as HTMLButtonElement)?.focus(), 50);
  }

  // --- Flyway / Skyway placeholder detection ---

  /**
   * Detect Flyway-style ${placeholder} tokens in SQL.
   * Returns unique placeholder names (without the ${} wrapper).
   */
  private detectPlaceholders(sql: string): string[] {
    const regex = /\$\{([^}]+)\}/g;
    const names = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sql)) !== null) {
      names.add(match[1]);
    }
    return Array.from(names);
  }

  /** Load remembered placeholder values from localStorage. */
  private loadPlaceholderValues(): Record<string, string> {
    try {
      const raw = localStorage.getItem(QueryComponent.PLACEHOLDER_VALUES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  /** Persist placeholder values to localStorage. */
  private savePlaceholderValues(values: Record<string, string>): void {
    localStorage.setItem(QueryComponent.PLACEHOLDER_VALUES_KEY, JSON.stringify(values));
  }

  /**
   * Show a dialog asking the user to fill in placeholder values.
   * Resolves with the substituted SQL, or null if the user cancelled.
   */
  private showPlaceholderDialog(placeholders: string[], sql: string): Promise<string | null> {
    return new Promise(resolve => {
      const remembered = this.loadPlaceholderValues();

      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: var(--bg-secondary); border-radius: 12px; border: 1px solid var(--border-primary);
        box-shadow: 0 8px 32px rgba(0,0,0,0.3); width: 480px; max-width: 90vw; overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      `;

      const inputRows = placeholders
        .map(name => {
          const val = remembered[name] || '';
          return `
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <label style="min-width:120px;color:var(--text-secondary);font-size:13px;font-family:monospace;text-align:right;flex-shrink:0;">
              \${${name}}
            </label>
            <input type="text" data-placeholder="${name}" value="${val.replace(/"/g, '&quot;')}"
              style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid var(--border-primary);
                background:var(--bg-primary);color:var(--text-primary);font-size:13px;font-family:monospace;outline:none;"
              placeholder="Enter value…" />
          </div>`;
        })
        .join('');

      dialog.innerHTML = `
        <div style="padding:16px 20px;border-bottom:1px solid var(--border-primary);display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">&#123;&#125;</span>
          <h3 style="margin:0;font-size:15px;font-weight:600;color:var(--text-primary);">Flyway Placeholders Detected</h3>
        </div>
        <div style="padding:20px;">
          <p style="margin:0 0 16px 0;color:var(--text-secondary);line-height:1.5;font-size:13px;">
            This SQL contains <strong style="color:var(--text-primary);">${placeholders.length}</strong>
            placeholder${placeholders.length > 1 ? 's' : ''}. Provide values to substitute before executing.
          </p>
          ${inputRows}
        </div>
        <div style="padding:12px 20px;border-top:1px solid var(--border-primary);background:var(--bg-tertiary);
          display:flex;justify-content:flex-end;gap:8px;border-radius:0 0 12px 12px;">
          <button id="ph-execute" style="
            padding:6px 16px;border-radius:6px;border:none;cursor:pointer;font-size:13px;font-weight:500;
            background:var(--status-info,#007acc);color:white;">Execute</button>
          <button id="ph-cancel" style="
            padding:6px 16px;border-radius:6px;border:1px solid var(--border-primary);cursor:pointer;font-size:13px;
            background:transparent;color:var(--text-primary);">Cancel</button>
        </div>`;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const cleanup = () => {
        overlay.remove();
      };

      const doExecute = () => {
        const inputs = dialog.querySelectorAll<HTMLInputElement>('input[data-placeholder]');
        const values: Record<string, string> = {};
        inputs.forEach(inp => {
          values[inp.dataset['placeholder']!] = inp.value;
        });

        // Persist for next time
        const merged = { ...remembered, ...values };
        this.savePlaceholderValues(merged);

        // Replace all ${name} occurrences in the SQL
        let resolved = sql;
        for (const [name, value] of Object.entries(values)) {
          resolved = resolved.split('${' + name + '}').join(value);
        }
        cleanup();
        resolve(resolved);
      };

      dialog.querySelector('#ph-execute')!.addEventListener('click', doExecute);
      dialog.querySelector('#ph-cancel')!.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
      overlay.addEventListener('click', e => {
        if (e.target === overlay) {
          cleanup();
          resolve(null);
        }
      });

      // Enter key in any input triggers execute
      dialog.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            doExecute();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            cleanup();
            resolve(null);
          }
        });
      });

      // Focus the first input
      setTimeout(() => {
        const first = dialog.querySelector<HTMLInputElement>('input[data-placeholder]');
        first?.focus();
        first?.select();
      }, 50);
    });
  }

  async executeQuery(): Promise<void> {
    let sql = this.getSelectedOrAllText();
    if (!sql.trim()) {
      this.notification.warning('No query to execute');
      return;
    }

    // Detect Flyway-style ${placeholder} tokens and prompt for values
    const placeholders = this.detectPlaceholders(sql);
    if (placeholders.length > 0) {
      const resolved = await this.showPlaceholderDialog(placeholders, sql);
      if (resolved === null) return; // User cancelled
      sql = resolved;
    }

    const currentTab = this.tabState.tabs().find(t => t.id === this.tabId);
    const connectionId = currentTab?.connectionId ?? this.tabConnectionId();
    const database = this.selectedDatabase || currentTab?.databaseName;

    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    // Prevent concurrent execution — cancel previous query if still running
    if (this.executing() && this.currentQueryId) {
      firstValueFrom(this.ipc.cancelQuery(this.currentQueryId)).catch(() => {});
    }

    this.executing.set(true);
    this.result.set(null);
    this.viewingHistoricalResult.set(null); // Clear any historical result view
    const queryId = `query-${Date.now()}`;
    this.currentQueryId = queryId;
    this.lastExecutedSql = sql;

    // Register with global execution tracker
    const tabTitle = this.tabState.tabs().find(t => t.id === this.tabId)?.title || 'Query';
    this.queryExecution.startExecution(this.tabId || this.currentQueryId, tabTitle);

    try {
      const result = await firstValueFrom(
        this.ipc.executeQuery({
          connectionId,
          database: database || undefined,
          sql,
          queryId,
        })
      );

      // Only update results if this is still the current query (not stale)
      if (this.currentQueryId !== queryId) return;

      this.result.set(result ?? null);
      this.activeTab.set(result?.resultSets?.length ? 'result-0' : 'messages');

      // Refresh history if panel is open
      if (this.showHistory()) {
        this.historyState.loadHistory();
      }

      // Auto-save result snapshot - use this.tabId for correct tab
      if (result && this.tabId && connectionId && database) {
        this.resultsState.saveSnapshot(this.tabId, sql, connectionId, database, result);
      }

      // Auto-rename tab after successful execution
      if (result?.success && this.tabId) {
        if (this.aiState.autoRenameEnabled()) {
          this.autoRenameTab(this.tabId, sql, database ?? undefined);
        } else {
          // Simple SQL-based rename: extract table/proc name from SQL
          this.updateTabTitleFromSql(this.tabId, sql);
        }
      }
    } catch (error) {
      this.result.set({
        queryId: this.currentQueryId,
        success: false,
        error: error instanceof Error ? error.message : 'Query execution failed',
        executionTime: 0,
      });
    } finally {
      this.executing.set(false);
      this.queryExecution.endExecution(this.tabId || '');
      this.currentQueryId = null;
    }
  }

  async cancelQuery(): Promise<void> {
    if (this.currentQueryId) {
      await firstValueFrom(this.ipc.cancelQuery(this.currentQueryId));
      this.notification.info('Query cancelled');
    }
  }

  onDatabaseChange(database: string): void {
    this.selectedDatabase = database;
    if (this.tabId) {
      this.tabState.updateTab(this.tabId, { databaseName: database });
    }
  }

  onConnectionChange(connectionId: string): void {
    if (!this.tabId) return;
    // Use the profile's configured default database, if any
    const profile = this.connectionState.getProfile(connectionId);
    const defaultDb = profile?.database ?? null;
    this.selectedDatabase = defaultDb;
    this.tabState.updateTab(this.tabId, { connectionId, databaseName: defaultDb ?? undefined });
  }

  // History panel methods
  toggleHistory(): void {
    const newState = !this.showHistory();
    this.showHistory.set(newState);
    if (newState) {
      this.historyState.loadHistory();
    }
  }

  onHistorySearch(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this.historyState.search(this.historySearchText);
    }, 300);
  }

  loadFromHistory(entry: QueryHistoryEntry): void {
    if (this.editor) {
      this.editor.setValue(entry.sql);
    }
    // Optionally switch to the database from history. Bind to this tab's
    // connection — query history entries are global but the selection is
    // a per-tab decision.
    const connId = this.tabConnectionId();
    if (entry.database && entry.database !== this.selectedDatabase && connId) {
      this.selectedDatabase = entry.database;
      this.connectionState.selectDatabase(connId, entry.database);
    }
    this.notification.info('Query loaded from history');
  }

  async clearHistory(): Promise<void> {
    try {
      await this.historyState.clearHistory();
      this.notification.success('History cleared');
    } catch {
      this.notification.error('Failed to clear history');
    }
  }

  formatHistoryTime(isoDate: string): string {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  truncateSql(sql: string): string {
    const maxLength = 150;
    const cleaned = sql.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.substring(0, maxLength) + '...';
  }

  // Export methods
  async exportResults(format: ExportFormat): Promise<void> {
    const resultSet = this.activeResultSet();
    if (!resultSet) {
      this.notification.warning('No results to export');
      return;
    }

    try {
      const result = await firstValueFrom(
        this.ipc.exportQueryResults(resultSet, {
          format,
          includeHeaders: true,
          prettyPrint: true,
          tableName: 'QueryResults',
        })
      );

      if (result?.success) {
        this.notification.success(`Exported ${result.rowsExported} rows to ${result.filePath}`);
      } else if (result?.error && result.error !== 'Export cancelled') {
        this.notification.error(`Export failed: ${result.error}`);
      }
    } catch (error) {
      this.notification.error('Export failed');
    }
  }

  exportAsJson(): void {
    const resultSet = this.activeResultSet();
    if (!resultSet?.rows?.length) return;

    const json = JSON.stringify(resultSet.rows, null, 2);
    this.downloadFile(json, 'results.json', 'application/json');
    this.notification.success(`Exported ${resultSet.rows.length} rows as JSON`);
  }

  exportAsSqlInsert(): void {
    const resultSet = this.activeResultSet();
    if (!resultSet?.rows?.length || !resultSet?.columns?.length) return;

    const tableName = this.getTableNameFromSql() || 'TableName';
    const columns = resultSet.columns.map(c => `[${c.name}]`).join(', ');

    const inserts = resultSet.rows
      .map(row => {
        const values = resultSet.columns
          .map(col => {
            const val = row[col.name];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') return String(val);
            if (typeof val === 'boolean') return val ? '1' : '0';
            return `'${String(val).replace(/'/g, "''")}'`;
          })
          .join(', ');
        return `INSERT INTO [${tableName}] (${columns}) VALUES (${values});`;
      })
      .join('\n');

    this.downloadFile(inserts, 'inserts.sql', 'text/plain');
    this.notification.success(`Exported ${resultSet.rows.length} INSERT statements`);
  }

  /**
   * Copy all result rows to clipboard as tab-separated values.
   * @param includeHeaders Whether to include the column header row (default: true)
   */
  async copyResultsToClipboard(includeHeaders = true): Promise<void> {
    const resultSet = this.activeResultSet();
    if (!resultSet?.rows?.length || !resultSet?.columns?.length) {
      this.notification.warning('No results to copy');
      return;
    }

    const lines: string[] = [];

    if (includeHeaders) {
      lines.push(resultSet.columns.map(col => col.name).join('\t'));
    }

    for (const row of resultSet.rows) {
      const values = resultSet.columns.map(col => {
        const val = row[col.name];
        if (val === null || val === undefined) return '';
        if (val instanceof Date) return val.toISOString();
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      });
      lines.push(values.join('\t'));
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      this.notification.success(
        `Copied ${resultSet.rows.length} row${resultSet.rows.length > 1 ? 's' : ''} to clipboard`
      );
    } catch {
      this.notification.error('Failed to copy to clipboard');
    }
  }

  private getTableNameFromSql(): string | null {
    const sql = this.getLastExecutedSql();
    if (!sql) return null;
    const match = sql.match(/FROM\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/i);
    return match ? match[2] : null;
  }

  private downloadFile(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  startResize(event: MouseEvent): void {
    // Clean up any previous resize listeners
    this.resizeCleanup?.();

    this.resizing = true;
    const startY = event.clientY;
    const startHeight = this.editorHeight();

    const onMouseMove = (e: MouseEvent) => {
      if (!this.resizing) return;
      const delta = e.clientY - startY;
      const containerHeight =
        this.editorContainer.nativeElement.parentElement?.parentElement?.clientHeight || 600;
      const newHeight = startHeight + (delta / containerHeight) * 100;
      this.editorHeight.set(Math.max(10, Math.min(90, newHeight)));
    };

    const cleanup = () => {
      this.resizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', cleanup);
      this.resizeCleanup = null;
    };

    this.resizeCleanup = cleanup;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', cleanup);
  }

  activeResultSet(): ResultSet | null {
    const r = this.result();
    const tab = this.activeTab();
    if (!tab.startsWith('result-')) return null;
    const idx = parseInt(tab.replace('result-', ''), 10);
    return r?.resultSets?.[idx] ?? null;
  }

  getFirstResultSet(): ResultSet | null {
    return this.result()?.resultSets?.[0] ?? null;
  }

  setActiveTab(tab: string): void {
    this.activeTab.set(tab);
  }

  private getSelectedOrAllText(): string {
    if (!this.editor) return '';
    const selection = this.editor.getSelection();
    if (selection && !selection.isEmpty()) {
      return this.editor.getModel()?.getValueInRange(selection) || '';
    }
    const scope = this.settings.querySettings().executeScope;
    if (scope === 'currentStatement') {
      return this.getStatementAtCursor();
    }
    return this.editor.getValue();
  }

  /**
   * Extract the single statement surrounding the cursor position.
   * Statement boundaries are semicolons (;) or GO on its own line.
   */
  private getStatementAtCursor(): string {
    if (!this.editor) return '';
    const model = this.editor.getModel();
    const pos = this.editor.getPosition();
    if (!model || !pos) return this.editor.getValue();

    const lineCount = model.getLineCount();
    const cursorLine = pos.lineNumber;

    // Scan backward from cursor line to find start of statement
    let startLine = 1;
    for (let i = cursorLine - 1; i >= 1; i--) {
      const line = model.getLineContent(i);
      if (/^\s*GO\s*$/i.test(line)) {
        startLine = i + 1;
        break;
      }
      if (line.includes(';')) {
        // The semicolon ends a prior statement; our statement starts after it.
        // If the semicolon is at the end of the line, start on the next line.
        // If there's text after the semicolon, we'd need column-level tracking,
        // but for practical SQL editing, semicolons are typically at line end.
        startLine = i + 1;
        break;
      }
    }

    // Scan forward from cursor line to find end of statement
    let endLine = lineCount;
    for (let i = cursorLine; i <= lineCount; i++) {
      const line = model.getLineContent(i);
      if (/^\s*GO\s*$/i.test(line)) {
        endLine = i - 1;
        break;
      }
      if (line.includes(';')) {
        endLine = i;
        break;
      }
    }

    // Collect lines
    const lines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      lines.push(model.getLineContent(i));
    }
    return lines.join('\n').trim();
  }

  /**
   * Execute query when editor is ready with the expected content.
   * Polls until editor is available and has the content loaded.
   */
  private executeWhenEditorReady(expectedContent: string, maxAttempts = 20): void {
    // Cancel any previous polling
    if (this.editorReadyTimer) {
      clearTimeout(this.editorReadyTimer);
      this.editorReadyTimer = null;
    }

    let attempts = 0;
    const checkAndExecute = (): void => {
      attempts++;
      if (this.editor && this.editor.getValue() === expectedContent) {
        this.editorReadyTimer = null;
        this.executeQuery();
      } else if (attempts < maxAttempts) {
        this.editorReadyTimer = setTimeout(checkAndExecute, 50);
      } else {
        this.editorReadyTimer = null;
        if (this.editor) {
          this.executeQuery();
        }
      }
    };
    this.editorReadyTimer = setTimeout(checkAndExecute, 50);
  }

  // Row detail panel methods.
  // The grid emits the clicked row's data and its DISPLAYED index — after
  // sorting/filtering, displayed index N no longer maps to resultSet.rows[N],
  // so the drawer and Next/Previous navigation go through the grid's
  // displayed-order API instead of the original rows array.
  onCellSelected(event: {
    row: number;
    column: string;
    value: unknown;
    data: Record<string, unknown>;
  }): void {
    const resultSet = this.activeResultSet();
    if (!resultSet) return;

    this.rowDetailData.set({
      rowIndex: event.row,
      row: event.data,
      columns: resultSet.columns,
    });
    this.rowDetailTotalRows.set(this.resultsGrid?.getDisplayedRowCount() ?? resultSet.rows.length);
    this.showRowDetail.set(true);
  }

  closeRowDetail(): void {
    this.showRowDetail.set(false);
    this.rowDetailData.set(null);
  }

  navigateRowDetail(direction: 'next' | 'previous'): void {
    const currentData = this.rowDetailData();
    const grid = this.resultsGrid;
    if (!currentData || !grid) return;

    const newIndex = direction === 'next' ? currentData.rowIndex + 1 : currentData.rowIndex - 1;
    const row = grid.getDisplayedRowAt(newIndex);
    if (!row) return;

    this.rowDetailData.set({
      rowIndex: newIndex,
      row,
      columns: currentData.columns,
    });
    this.rowDetailTotalRows.set(grid.getDisplayedRowCount());
  }

  /**
   * Open Monaco's built-in Find widget.
   * Supports regex, case sensitivity, whole word, and find-in-selection.
   */
  openFind(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger('keyboard', 'actions.find', undefined);
  }

  /**
   * Open Monaco's built-in Find & Replace widget.
   * Supports regex-based replacement with capture group references ($1, $2, etc).
   */
  openFindReplace(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger('keyboard', 'editor.action.startFindReplaceAction', undefined);
  }

  /**
   * Open Monaco's Go to Line dialog (Ctrl+G).
   */
  goToLine(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger('keyboard', 'editor.action.gotoLine', undefined);
  }

  /**
   * Toggle line comment via Monaco action (Ctrl+/).
   */
  toggleComment(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger('keyboard', 'editor.action.commentLine', undefined);
  }

  /**
   * Save the current query SQL to a .sql file via native dialog.
   */
  async saveQueryToFile(): Promise<void> {
    if (!this.editor) return;
    const sql = this.editor.getValue();
    if (!sql.trim()) {
      this.notification.warning('No query to save');
      return;
    }
    try {
      const result = await firstValueFrom(
        this.ipc.showSaveDialog({
          title: 'Save Query',
          defaultPath: 'query.sql',
          filters: [
            { name: 'SQL Files', extensions: ['sql'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        })
      );
      if (result?.filePath) {
        await firstValueFrom(this.ipc.writeWorkspaceFile(result.filePath, sql));
        this.notification.success('Query saved');
      }
    } catch {
      this.notification.error('Failed to save query');
    }
  }

  /**
   * Open a .sql file and load its contents into the editor.
   */
  async openQueryFromFile(): Promise<void> {
    try {
      const result = await firstValueFrom(
        this.ipc.showOpenDialog({
          title: 'Open Query',
          filters: [
            { name: 'SQL Files', extensions: ['sql'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        })
      );
      if (result?.filePaths?.length) {
        const content = await firstValueFrom(this.ipc.readWorkspaceFile(result.filePaths[0]));
        if (this.editor) {
          this.editor.setValue(content);
        }
      }
    } catch {
      this.notification.error('Failed to open query file');
    }
  }

  // SQL Formatting
  formatSql(): void {
    if (!this.editor) {
      this.notification.warning('Editor not ready');
      return;
    }

    const sql = this.editor.getValue();
    if (!sql.trim()) {
      this.notification.warning('No SQL to format');
      return;
    }

    try {
      const engine = this.tabProfile()?.engine;
      const language =
        engine === 'mysql' ? 'mysql' : engine === 'postgresql' ? 'postgresql' : 'tsql';
      const formatted = formatSQL(sql, {
        language,
        tabWidth: 2,
        useTabs: false,
        keywordCase: 'upper',
        dataTypeCase: 'upper',
        functionCase: 'upper',
        linesBetweenQueries: 2,
      });
      this.editor.setValue(formatted);
      this.notification.success('SQL formatted');
    } catch (error) {
      this.notification.error('Failed to format SQL');
      console.error('SQL formatting error:', error);
    }
  }

  async convertSqlTo(targetEngine: string): Promise<void> {
    if (!this.editor) return;

    const sql = this.getSelectedOrAllText();
    if (!sql.trim()) {
      this.notification.warning('No SQL to convert');
      return;
    }

    const fromEngine = this.tabProfile()?.engine || 'mssql';
    try {
      const result = await firstValueFrom(this.ipc.convertSql(sql, fromEngine, targetEngine));
      if (result.success) {
        this.editor.setValue(result.sql);
        const labels: Record<string, string> = {
          mssql: 'SQL Server',
          postgresql: 'PostgreSQL',
          mysql: 'MySQL',
        };
        this.notification.success(`Converted to ${labels[targetEngine] || targetEngine}`);
      } else {
        this.notification.error(result.error || 'Conversion failed');
      }
    } catch {
      this.notification.error('SQL conversion failed');
    }
  }

  async showExecutionPlan(): Promise<void> {
    const sql = this.getSelectedOrAllText();
    if (!sql.trim()) {
      this.notification.warning('No query to show plan for');
      return;
    }

    const connectionId = this.tabConnectionId();
    const database = this.selectedDatabase;
    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    const engine = this.tabProfile()?.engine || 'mssql';
    this.executing.set(true);
    this.planData.set(null);
    this.planMysqlExplainUrl.set(null);

    try {
      let planSql: string;
      switch (engine) {
        case 'mysql':
          planSql = `EXPLAIN FORMAT=JSON ${sql}`;
          break;
        case 'postgresql':
          planSql = `EXPLAIN (FORMAT JSON) ${sql}`;
          break;
        default:
          planSql = `SET SHOWPLAN_TEXT ON;\n${sql}\nSET SHOWPLAN_TEXT OFF;`;
          break;
      }

      const result = await firstValueFrom(
        this.ipc.executeQuery({
          connectionId,
          database: database || undefined,
          sql: planSql,
          queryId: `plan-${Date.now()}`,
        })
      );

      // Store the normal result for the Messages tab
      this.result.set(result ?? null);

      // Extract and parse the plan JSON from the result
      const planJson = this.extractPlanJson(result, engine);
      if (planJson) {
        this.planData.set(planJson);
        this.planEngine.set(engine);
        this.activeTab.set('plan');

        // For MySQL, submit to mysqlexplain.com in background
        if (engine === 'mysql') {
          this.submitToMysqlExplain(sql, planJson);
        }
      } else if (engine === 'mssql' && result?.resultSets?.length) {
        // MSSQL text plan: extract rows as text
        const textRows = result.resultSets
          .flatMap(rs => rs.rows)
          .map(row => Object.values(row)[0])
          .filter(Boolean);
        this.planData.set(textRows);
        this.planEngine.set(engine);
        this.activeTab.set('plan');
      } else {
        this.activeTab.set(result?.resultSets?.length ? 'result-0' : 'messages');
      }

      this.notification.success('Execution plan generated');
    } catch (error) {
      this.result.set({
        queryId: `plan-${Date.now()}`,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get execution plan',
        executionTime: 0,
      });
      this.activeTab.set('messages');
    } finally {
      this.executing.set(false);
    }
  }

  /**
   * Extract the JSON execution plan from a query result.
   * MySQL and PostgreSQL EXPLAIN FORMAT=JSON return JSON text in the first column of the first row.
   */
  private extractPlanJson(result: QueryResult | null | undefined, engine: string): unknown {
    if (!result?.resultSets?.length) return null;
    const firstRow = result.resultSets[0]?.rows?.[0];
    if (!firstRow) return null;

    // Get the first column value (the JSON text)
    const jsonText = Object.values(firstRow)[0];
    if (typeof jsonText !== 'string') return null;

    try {
      return JSON.parse(jsonText);
    } catch {
      // PostgreSQL sometimes returns multiple rows that together form the JSON
      if (engine === 'postgresql') {
        const allText = result.resultSets[0].rows.map(r => Object.values(r)[0]).join('');
        try {
          return JSON.parse(allText);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  /**
   * Submit explain data to mysqlexplain.com for visual rendering.
   * Runs in background — sets the URL when available.
   */
  private async submitToMysqlExplain(query: string, explainJson: unknown): Promise<void> {
    try {
      const response = await fetch('https://api.mysqlexplain.com/v2/explains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          explain_json: explainJson,
        }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data?.url) {
          this.planMysqlExplainUrl.set(data.url);
        }
      }
    } catch {
      // Non-critical — visual plan still works locally
    }
  }

  // Get last executed SQL for AI analysis
  getLastExecutedSql(): string {
    return this.lastExecutedSql;
  }

  // View a historical result snapshot
  onViewHistoryResult(snapshot: QueryResultSnapshot): void {
    // Create a QueryResult from the snapshot to display
    if (snapshot.resultSets && snapshot.resultSets.length > 0) {
      this.viewingHistoricalResult.set(snapshot);
      this.result.set({
        queryId: snapshot.id,
        success: snapshot.success,
        resultSets: snapshot.resultSets,
        executionTime: snapshot.executionTimeMs,
        error: snapshot.error,
      });
      this.activeTab.set('result-0');
      this.lastExecutedSql = snapshot.sql;
    }
  }

  // Clear historical result and return to showing nothing
  clearHistoricalResult(): void {
    this.viewingHistoricalResult.set(null);
    this.result.set(null);
  }

  // Format date for historical result banner
  formatHistoricalDate(snapshot: QueryResultSnapshot): string {
    const date = new Date(snapshot.executedAt);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  // Compare two result snapshots (now handled inline in history panel)
  onCompareResults(_comparison: { base: QueryResultSnapshot; compare: QueryResultSnapshot }): void {
    // Comparison is now handled inline in the result history panel
    // This method is kept for backward compatibility but no longer does anything
  }

  /**
   * Update tab title from SQL content (non-AI fallback).
   * Extracts table/procedure name for a concise title.
   */
  private updateTabTitleFromSql(tabId: string, sql: string): void {
    const cleaned = sql.replace(/\s+/g, ' ').trim();

    // SELECT ... FROM [schema].[table]
    const selectMatch = cleaned.match(/^SELECT\b.*?\bFROM\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/i);
    if (selectMatch) {
      const table = selectMatch[2];
      const title = table.length > 20 ? `${table.substring(0, 18)}…` : table;
      this.tabState.renameTab(tabId, title);
      return;
    }

    // EXEC [schema].[proc]
    const execMatch = cleaned.match(/^EXEC(?:UTE)?\s+(?:\[?(\w+)\]?\.)?\[?(\w+)\]?/i);
    if (execMatch) {
      const proc = execMatch[2];
      this.tabState.renameTab(
        tabId,
        `Exec ${proc.length > 16 ? proc.substring(0, 14) + '…' : proc}`
      );
      return;
    }

    // For other SQL, use a short preview
    if (cleaned.length > 5) {
      const preview = cleaned.substring(0, 22);
      this.tabState.renameTab(tabId, preview.length < cleaned.length ? `${preview}…` : preview);
    }
  }

  // Auto-rename tab using AI
  private async autoRenameTab(tabId: string, sql: string, database?: string): Promise<void> {
    try {
      const response = await this.aiState.generateTabName({
        sql,
        database,
      });

      if (response?.suggestedName) {
        this.tabState.renameTab(tabId, response.suggestedName);
      }
    } catch (error) {
      // Silent fail - tab renaming is non-critical
      console.debug('Auto-rename tab failed:', error);
    }
  }

  // Open a query in a new tab (from FK navigation)
  openQueryInNewTab(query: { sql: string; title: string }): void {
    const connectionId = this.tabConnectionId();
    if (!connectionId) {
      this.notification.error('No active connection');
      return;
    }

    // Create a new query tab with the SQL and auto-execute it
    const tabId = this.tabState.openQueryTab(
      connectionId,
      this.selectedDatabase ?? '',
      query.sql,
      true // autoExecute
    );

    // Rename the tab to use the FK table/value title
    if (query.title) {
      this.tabState.renameTab(tabId, query.title);
    }
  }
}
