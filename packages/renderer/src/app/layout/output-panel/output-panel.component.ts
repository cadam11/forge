import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { LogEntry } from '@mj-forge/shared';
import { LogService } from '../../core/services/log.service';

type LevelFilter = 'all' | 'errors';

/**
 * Bottom-docked Output / Console panel. Shows the unified main+renderer log
 * timeline with an Errors-only toggle, per-entry expandable detail, copy, and
 * a link to reveal the on-disk log file. Opened from the status-bar badge or
 * the "Details" action on an error toast.
 */
@Component({
  selector: 'app-output-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="output-panel">
      <div class="op-header">
        <span class="op-title">Output</span>
        <div class="op-tabs">
          <button class="op-tab" [class.active]="filter() === 'all'" (click)="filter.set('all')">
            Log <span class="op-count">{{ logService.entries().length }}</span>
          </button>
          <button
            class="op-tab"
            [class.active]="filter() === 'errors'"
            (click)="filter.set('errors')"
          >
            Errors <span class="op-count error">{{ logService.errorCount() }}</span>
          </button>
        </div>
        <span class="op-spacer"></span>
        <button class="op-action" matTooltip="Reveal log file" (click)="logService.revealFile()">
          <mat-icon>folder_open</mat-icon>
        </button>
        <button class="op-action" matTooltip="Clear" (click)="logService.clear()">
          <mat-icon>delete_sweep</mat-icon>
        </button>
        <button class="op-action" matTooltip="Close (⌘J)" (click)="logService.close()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div #scroll class="op-body">
        @for (entry of visibleEntries(); track entry.id) {
          <div
            class="op-row"
            [class.error]="entry.level === 'error'"
            [class.warn]="entry.level === 'warn'"
            [class.focused]="entry.id === logService.focusedEntryId()"
            [attr.data-entry-id]="entry.id"
          >
            <div class="op-line" (click)="toggle(entry)">
              <mat-icon class="op-chevron" [class.open]="isExpanded(entry)" *ngIf="entry.detail">
                chevron_right
              </mat-icon>
              <span class="op-chevron-spacer" *ngIf="!entry.detail"></span>
              <span class="op-time">{{ entry.timestamp | date: 'HH:mm:ss.SSS' }}</span>
              <span class="op-level" [attr.data-level]="entry.level">{{ entry.level }}</span>
              <span class="op-tag">{{ entry.tag }}</span>
              <span class="op-msg">{{ entry.message }}</span>
              <button
                class="op-copy"
                matTooltip="Copy"
                (click)="copy(entry); $event.stopPropagation()"
              >
                <mat-icon>content_copy</mat-icon>
              </button>
            </div>
            @if (entry.detail && isExpanded(entry)) {
              <pre class="op-detail">{{ entry.detail }}</pre>
            }
          </div>
        } @empty {
          <div class="op-empty">No log entries yet.</div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .output-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 12px;
      }
      .op-header {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 30px;
        padding: 0 8px;
        border-bottom: 1px solid var(--border-primary);
        flex-shrink: 0;
      }
      .op-title {
        font-weight: 600;
        text-transform: uppercase;
        font-size: 11px;
        letter-spacing: 0.5px;
        color: var(--text-secondary);
      }
      .op-tabs {
        display: flex;
        gap: 2px;
        margin-left: 8px;
      }
      .op-tab {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        padding: 2px 8px;
        cursor: pointer;
        border-radius: 4px;
        font-size: 12px;
      }
      .op-tab.active {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }
      .op-count {
        opacity: 0.7;
        font-variant-numeric: tabular-nums;
      }
      .op-count.error {
        color: var(--accent-error, #e5534b);
      }
      .op-spacer {
        flex: 1;
      }
      .op-action {
        background: transparent;
        border: none;
        color: var(--text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        padding: 2px;
        border-radius: 4px;
      }
      .op-action:hover {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }
      .op-action mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      .op-body {
        flex: 1;
        overflow-y: auto;
        font-family: var(--font-mono, monospace);
      }
      .op-row {
        border-bottom: 1px solid var(--border-subtle, rgba(127, 127, 127, 0.12));
      }
      .op-row.error {
        background: rgba(229, 83, 75, 0.08);
      }
      .op-row.warn {
        background: rgba(224, 168, 0, 0.07);
      }
      .op-row.focused {
        outline: 1px solid var(--accent-primary, #007acc);
        outline-offset: -1px;
      }
      .op-line {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 8px;
        cursor: default;
        white-space: nowrap;
      }
      .op-chevron {
        font-size: 16px;
        width: 16px;
        height: 16px;
        transition: transform 0.1s ease;
        cursor: pointer;
      }
      .op-chevron.open {
        transform: rotate(90deg);
      }
      .op-chevron-spacer {
        width: 16px;
        flex-shrink: 0;
      }
      .op-time {
        color: var(--text-tertiary, #888);
        flex-shrink: 0;
      }
      .op-level {
        text-transform: uppercase;
        font-size: 10px;
        font-weight: 700;
        width: 42px;
        flex-shrink: 0;
      }
      .op-level[data-level='error'] {
        color: var(--accent-error, #e5534b);
      }
      .op-level[data-level='warn'] {
        color: var(--accent-warning, #e0a800);
      }
      .op-level[data-level='info'] {
        color: var(--accent-info, #4a9eff);
      }
      .op-level[data-level='debug'] {
        color: var(--text-tertiary, #888);
      }
      .op-tag {
        color: var(--text-secondary);
        flex-shrink: 0;
      }
      .op-msg {
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
      }
      .op-copy {
        background: transparent;
        border: none;
        color: var(--text-tertiary, #888);
        cursor: pointer;
        opacity: 0;
        display: flex;
        align-items: center;
        padding: 0;
      }
      .op-line:hover .op-copy {
        opacity: 1;
      }
      .op-copy mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
      .op-detail {
        margin: 0;
        padding: 6px 8px 8px 38px;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--text-secondary);
        background: var(--bg-primary);
        font-size: 11px;
      }
      .op-empty {
        padding: 16px;
        color: var(--text-tertiary, #888);
        text-align: center;
      }
    `,
  ],
})
export class OutputPanelComponent implements AfterViewChecked {
  readonly logService = inject(LogService);

  readonly filter = signal<LevelFilter>('all');
  private readonly expandedIds = signal<Set<string>>(new Set());
  private readonly scroll = viewChild<ElementRef<HTMLDivElement>>('scroll');
  private lastFocusHandled: string | null = null;

  readonly visibleEntries = computed<LogEntry[]>(() => {
    const all = this.logService.entries();
    return this.filter() === 'errors' ? all.filter(e => e.level === 'error') : all;
  });

  ngAfterViewChecked(): void {
    // When opened with a focused entry (from an error toast), scroll to it once.
    const focusId = this.logService.focusedEntryId();
    if (focusId && focusId !== this.lastFocusHandled) {
      const el = this.scroll()?.nativeElement.querySelector(`[data-entry-id="${focusId}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        this.lastFocusHandled = focusId;
        // Auto-expand the focused entry's detail.
        this.expandedIds.update(s => new Set(s).add(focusId));
      }
    }
  }

  isExpanded(entry: LogEntry): boolean {
    return this.expandedIds().has(entry.id);
  }

  toggle(entry: LogEntry): void {
    if (!entry.detail) return;
    this.expandedIds.update(s => {
      const next = new Set(s);
      if (next.has(entry.id)) next.delete(entry.id);
      else next.add(entry.id);
      return next;
    });
  }

  copy(entry: LogEntry): void {
    const text = `[${entry.level.toUpperCase()}] [${entry.tag}] ${entry.message}${
      entry.detail ? '\n' + entry.detail : ''
    }`;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }
}
