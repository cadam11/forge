import { Component, inject, HostListener, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SettingsService } from '../../../core/services/settings.service';
import { AIStateService } from '../../../core/state/ai.state';
import type { ThemePreference } from '@forgedb/shared';
import { keyHint } from '../../../core/utils/platform';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
  ],
  template: `
    @if (settingsService.isOpen()) {
      <div class="settings-overlay" (click)="close()"></div>
      <div class="settings-panel" (click)="$event.stopPropagation()">
        <header class="settings-header">
          <h2>Settings</h2>
          <button mat-icon-button (click)="close()" matTooltip="Close (Esc)">
            <mat-icon>close</mat-icon>
          </button>
        </header>

        <div class="settings-content">
          <!-- Appearance Section -->
          <section class="settings-section">
            <h3>
              <mat-icon>palette</mat-icon>
              Appearance
            </h3>

            <div class="setting-item">
              <div class="setting-info">
                <label>Theme</label>
                <span class="setting-description">Choose your preferred color theme</span>
              </div>
              <mat-form-field appearance="outline" class="theme-select">
                <mat-select
                  [value]="settings().theme"
                  (selectionChange)="updateTheme($event.value)"
                >
                  <mat-option value="system">
                    <mat-icon>brightness_auto</mat-icon>
                    System
                  </mat-option>
                  <mat-option value="light">
                    <mat-icon>light_mode</mat-icon>
                    Light
                  </mat-option>
                  <mat-option value="dark">
                    <mat-icon>dark_mode</mat-icon>
                    Dark
                  </mat-option>
                </mat-select>
              </mat-form-field>
            </div>
          </section>

          <!-- Editor Section -->
          <section class="settings-section">
            <h3>
              <mat-icon>code</mat-icon>
              Editor
            </h3>

            <div class="setting-item">
              <div class="setting-info">
                <label>Font Size</label>
                <span class="setting-description">Editor font size in pixels</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().editor.fontSize"
                  (change)="updateEditorSetting('fontSize', +$any($event.target).value)"
                  min="10"
                  max="24"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Tab Size</label>
                <span class="setting-description">Number of spaces per tab</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().editor.tabSize"
                  (change)="updateEditorSetting('tabSize', +$any($event.target).value)"
                  min="2"
                  max="8"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Word Wrap</label>
                <span class="setting-description">Wrap long lines in the editor</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().editor.wordWrap"
                (change)="updateEditorSetting('wordWrap', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Minimap</label>
                <span class="setting-description">Show code minimap on the right</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().editor.minimap"
                (change)="updateEditorSetting('minimap', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Line Numbers</label>
                <span class="setting-description">Show line numbers in the editor</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().editor.lineNumbers"
                (change)="updateEditorSetting('lineNumbers', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Auto Complete</label>
                <span class="setting-description">Show suggestions while typing</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().editor.autoComplete"
                (change)="updateEditorSetting('autoComplete', $event.checked)"
              />
            </div>
          </section>

          <!-- Query Execution Section -->
          <section class="settings-section">
            <h3>
              <mat-icon>play_arrow</mat-icon>
              Query Execution
            </h3>

            <div class="setting-item">
              <div class="setting-info">
                <label>Default Timeout</label>
                <span class="setting-description">Query timeout in seconds</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().query.defaultTimeout / 1000"
                  (change)="updateQuerySetting('defaultTimeout', +$any($event.target).value * 1000)"
                  min="5"
                  max="300"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Max Rows to Display</label>
                <span class="setting-description">Limit rows shown in results grid</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().query.maxRowsToDisplay"
                  (change)="updateQuerySetting('maxRowsToDisplay', +$any($event.target).value)"
                  min="100"
                  max="100000"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Show Execution Time</label>
                <span class="setting-description">Display query execution duration</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().query.showExecutionTime"
                (change)="updateQuerySetting('showExecutionTime', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Execute Scope</label>
                <span class="setting-description">What to run when there's no selection</span>
              </div>
              <mat-form-field appearance="outline" class="scope-select">
                <mat-select
                  [value]="settings().query.executeScope"
                  (selectionChange)="updateQuerySetting('executeScope', $event.value)"
                >
                  <mat-option value="all">All statements</mat-option>
                  <mat-option value="currentStatement">Current statement</mat-option>
                </mat-select>
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Confirm Before Execute</label>
                <span class="setting-description">Show confirmation before running queries</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().query.confirmBeforeExecute"
                (change)="updateQuerySetting('confirmBeforeExecute', $event.checked)"
              />
            </div>
          </section>

          <!-- Results Grid Section -->
          <section class="settings-section">
            <h3>
              <mat-icon>grid_on</mat-icon>
              Results Grid
            </h3>

            <div class="setting-item">
              <div class="setting-info">
                <label>Row Height</label>
                <span class="setting-description">Height of each row in pixels</span>
              </div>
              <mat-form-field appearance="outline" class="number-input">
                <input
                  matInput
                  type="number"
                  [value]="settings().grid.rowHeight"
                  (change)="updateGridSetting('rowHeight', +$any($event.target).value)"
                  min="20"
                  max="48"
                />
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Show Row Numbers</label>
                <span class="setting-description">Display row numbers column</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().grid.showRowNumbers"
                (change)="updateGridSetting('showRowNumbers', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Alternating Row Colors</label>
                <span class="setting-description">Zebra striping for rows</span>
              </div>
              <mat-slide-toggle
                [checked]="settings().grid.alternatingRowColors"
                (change)="updateGridSetting('alternatingRowColors', $event.checked)"
              />
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Copy Format</label>
                <span class="setting-description">
                  Format used by the inline Copy button ({{ copyKeyHint }}). The Export menu always
                  offers the full set.
                </span>
              </div>
              <mat-form-field appearance="outline" class="select-input">
                <mat-select
                  [value]="settings().grid.copyFormat"
                  (selectionChange)="updateGridSetting('copyFormat', $event.value)"
                >
                  <mat-option value="tsv">TSV (tab-separated, pastes into Excel)</mat-option>
                  <mat-option value="csv">CSV (comma-separated)</mat-option>
                  <mat-option value="json">JSON</mat-option>
                </mat-select>
              </mat-form-field>
            </div>

            <div class="setting-item">
              <div class="setting-info">
                <label>Include Headers When Copying</label>
                <span class="setting-description">
                  Prepend column names as the first row (TSV / CSV only).
                </span>
              </div>
              <mat-slide-toggle
                [checked]="settings().grid.copyIncludeHeaders"
                [disabled]="settings().grid.copyFormat === 'json'"
                (change)="updateGridSetting('copyIncludeHeaders', $event.checked)"
              />
            </div>
          </section>

          <!-- AI Integration Section -->
          <section class="settings-section">
            <h3>
              <mat-icon>auto_awesome</mat-icon>
              AI Integration
            </h3>

            <div class="setting-item ai-master-toggle">
              <div class="setting-info">
                <label>Enable AI Features</label>
                <span class="setting-description">Use AI for smart features</span>
              </div>
              <mat-slide-toggle
                [checked]="aiState.isEnabled()"
                (change)="aiState.setEnabled($event.checked)"
              />
            </div>

            @if (aiState.isEnabled()) {
              <!-- Feature Toggles -->
              <div class="ai-features">
                <div class="setting-item">
                  <div class="setting-info">
                    <label>Auto-Rename Tabs</label>
                    <span class="setting-description">AI generates descriptive tab names</span>
                  </div>
                  <mat-slide-toggle
                    [checked]="aiState.settings().features.autoRenameEnabled"
                    (change)="aiState.updateFeatureSettings({ autoRenameEnabled: $event.checked })"
                  />
                </div>

                <div class="setting-item">
                  <div class="setting-info">
                    <label>Results Analysis</label>
                    <span class="setting-description">AI insights for query results</span>
                  </div>
                  <mat-slide-toggle
                    [checked]="aiState.settings().features.analysisEnabled"
                    (change)="aiState.updateFeatureSettings({ analysisEnabled: $event.checked })"
                  />
                </div>

                <div class="setting-item">
                  <div class="setting-info">
                    <label>Query Assist</label>
                    <span class="setting-description">Generate SQL from natural language</span>
                  </div>
                  <mat-slide-toggle
                    [checked]="aiState.settings().features.queryAssistEnabled"
                    (change)="aiState.updateFeatureSettings({ queryAssistEnabled: $event.checked })"
                  />
                </div>
              </div>

              <!-- Vendor Configuration -->
              <div class="ai-vendors-header">
                <span>AI Providers</span>
                @if (!aiState.hasConfiguredVendors()) {
                  <span class="vendor-warning">
                    <mat-icon>warning</mat-icon>
                    Configure at least one provider
                  </span>
                }
              </div>

              <mat-accordion class="ai-vendors-accordion" multi>
                @for (vendor of aiState.vendors(); track vendor.id) {
                  <mat-expansion-panel class="vendor-panel">
                    <mat-expansion-panel-header>
                      <mat-panel-title>
                        <span class="vendor-name">{{ vendor.name }}</span>
                        @if (getVendorConfigured(vendor.id)) {
                          <mat-icon class="vendor-configured">check_circle</mat-icon>
                        }
                      </mat-panel-title>
                    </mat-expansion-panel-header>

                    <div class="vendor-content">
                      <div class="setting-item">
                        <div class="setting-info">
                          <label>Enable {{ vendor.name }}</label>
                        </div>
                        <mat-slide-toggle
                          [checked]="getVendorEnabled(vendor.id)"
                          (change)="aiState.setVendorEnabled(vendor.id, $event.checked)"
                        />
                      </div>

                      <!-- Model selector -->
                      @if (vendor.models.length > 0) {
                        <div class="setting-item model-selector">
                          <div class="setting-info">
                            <label>Preferred Model</label>
                            <span class="setting-description">Model used for AI features</span>
                          </div>
                          <mat-form-field appearance="outline" class="model-select-field">
                            <mat-select
                              [value]="getPreferredModel(vendor.id) || vendor.models[0].id"
                              (selectionChange)="aiState.setPreferredModel(vendor.id, $event.value)"
                            >
                              @for (model of vendor.models; track model.id) {
                                <mat-option [value]="model.id">
                                  {{ model.name }}
                                  <span class="model-tier">{{ model.costTier }}</span>
                                </mat-option>
                              }
                            </mat-select>
                          </mat-form-field>
                        </div>
                      }

                      <div class="api-key-section">
                        <mat-form-field appearance="outline" class="api-key-input">
                          <mat-label>API Key</mat-label>
                          <input
                            matInput
                            type="password"
                            [value]="apiKeyInputs()[vendor.id] || ''"
                            (input)="updateApiKeyInput(vendor.id, $any($event.target).value)"
                            placeholder="Enter API key..."
                          />
                        </mat-form-field>

                        <div class="api-key-actions">
                          @if (getVendorConfigured(vendor.id)) {
                            <button
                              mat-stroked-button
                              color="warn"
                              (click)="removeApiKey(vendor.id)"
                              [disabled]="aiState.validatingKey()"
                            >
                              Remove
                            </button>
                          }
                          <button
                            mat-flat-button
                            color="primary"
                            (click)="saveApiKey(vendor.id)"
                            [disabled]="!apiKeyInputs()[vendor.id] || aiState.validatingKey()"
                          >
                            @if (aiState.validatingKey()) {
                              <mat-spinner diameter="16"></mat-spinner>
                            } @else {
                              Save
                            }
                          </button>
                        </div>
                      </div>

                      @if (vendor.docsUrl) {
                        <a class="vendor-docs-link" [href]="vendor.docsUrl" target="_blank">
                          <mat-icon>open_in_new</mat-icon>
                          Get API Key
                        </a>
                      }
                    </div>
                  </mat-expansion-panel>
                }
              </mat-accordion>
            }
          </section>
        </div>

        <footer class="settings-footer">
          <button mat-stroked-button (click)="resetToDefaults()">
            <mat-icon>restore</mat-icon>
            Reset to Defaults
          </button>
          <span class="keyboard-hint">Press Esc to close</span>
        </footer>
      </div>
    }
  `,
  styles: [
    `
      .settings-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 10001;
        animation: fadeIn 0.2s ease;
      }

      .settings-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 420px;
        max-width: 90vw;
        background-color: var(--bg-secondary);
        border-left: 1px solid var(--border-primary);
        z-index: 10002;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.25s ease;
        box-shadow: var(--shadow-lg);
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes slideIn {
        from {
          transform: translateX(100%);
        }
        to {
          transform: translateX(0);
        }
      }

      .settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        border-bottom: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);

        h2 {
          font-size: var(--font-size-xl);
          font-weight: 600;
          margin: 0;
          color: var(--text-primary);
        }
      }

      .settings-content {
        flex: 1;
        overflow-y: auto;
        padding: var(--spacing-md);
      }

      .settings-section {
        margin-bottom: var(--spacing-lg);

        h3 {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          font-size: var(--font-size-md);
          font-weight: 600;
          color: var(--text-primary);
          margin: 0 0 var(--spacing-md);
          padding-bottom: var(--spacing-sm);
          border-bottom: 1px solid var(--border-primary);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            color: var(--status-info);
          }
        }
      }

      .setting-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-xs);
        border-radius: var(--radius-md);
        background-color: var(--bg-primary);
        transition: background-color var(--transition-fast);

        &:hover {
          background-color: var(--bg-hover);
        }
      }

      .setting-info {
        display: flex;
        flex-direction: column;
        gap: 2px;

        label {
          font-size: var(--font-size-md);
          font-weight: 500;
          color: var(--text-primary);
        }

        .setting-description {
          font-size: var(--font-size-xs);
          color: var(--text-secondary);
        }
      }

      .theme-select {
        width: 140px;

        ::ng-deep .mat-mdc-select-value {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
        }

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
          margin-right: var(--spacing-xs);
        }
      }

      .number-input {
        width: 100px;
      }

      .scope-select {
        width: 180px;
      }

      .select-input {
        width: 280px;
      }

      ::ng-deep .mat-mdc-form-field-subscript-wrapper {
        display: none;
      }

      ::ng-deep .mat-mdc-text-field-wrapper {
        background-color: var(--bg-tertiary);
      }

      ::ng-deep .mat-mdc-form-field.mat-focused .mat-mdc-text-field-wrapper {
        background-color: var(--bg-primary);
      }

      ::ng-deep .mat-mdc-slide-toggle {
        --mdc-switch-selected-track-color: var(--status-info);
        --mdc-switch-selected-handle-color: white;
        --mdc-switch-selected-hover-track-color: var(--status-info);
        --mdc-switch-selected-focus-track-color: var(--status-info);
        --mdc-switch-selected-pressed-track-color: var(--status-info);
      }

      .settings-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-md) var(--spacing-lg);
        border-top: 1px solid var(--border-primary);
        background-color: var(--bg-tertiary);

        button {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          color: var(--text-secondary);

          mat-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
          }

          &:hover {
            color: var(--text-primary);
          }
        }

        .keyboard-hint {
          font-size: var(--font-size-xs);
          color: var(--text-muted);
        }
      }

      /* AI Section Styles */
      .ai-master-toggle {
        background-color: var(--bg-tertiary);
        border: 1px solid var(--border-primary);
      }

      .ai-features {
        margin-top: var(--spacing-sm);
        padding-left: var(--spacing-md);
        border-left: 2px solid var(--status-info);
      }

      .ai-vendors-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: var(--spacing-md) 0 var(--spacing-sm);
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--text-secondary);
      }

      .vendor-warning {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        color: var(--status-warning);
        font-size: var(--font-size-xs);

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }

      .ai-vendors-accordion {
        ::ng-deep .mat-expansion-panel {
          background-color: var(--bg-primary);
          border: 1px solid var(--border-primary);
          margin-bottom: var(--spacing-xs);
          border-radius: var(--radius-md) !important;

          &:not(.mat-expanded) {
            border-radius: var(--radius-md) !important;
          }
        }

        ::ng-deep .mat-expansion-panel-header {
          padding: 0 var(--spacing-md);
          height: 48px;
        }

        ::ng-deep .mat-expansion-panel-body {
          padding: 0 var(--spacing-md) var(--spacing-md);
        }
      }

      .vendor-panel {
        .vendor-name {
          font-weight: 500;
          color: var(--text-primary);
        }

        .vendor-configured {
          font-size: 16px;
          width: 16px;
          height: 16px;
          margin-left: var(--spacing-sm);
          color: var(--status-success);
        }
      }

      .vendor-content {
        .setting-item {
          margin-bottom: var(--spacing-sm);
        }
      }

      .model-selector {
        flex-direction: column;
        align-items: stretch;
      }

      .model-select-field {
        width: 100%;
        margin-top: var(--spacing-xs);

        ::ng-deep .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }
      }

      .model-tier {
        font-size: 10px;
        text-transform: uppercase;
        opacity: 0.6;
        margin-left: 8px;
      }

      .api-key-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-sm);
      }

      .api-key-input {
        width: 100%;

        ::ng-deep .mat-mdc-form-field-subscript-wrapper {
          display: none;
        }
      }

      .api-key-actions {
        display: flex;
        gap: var(--spacing-sm);
        justify-content: flex-end;

        button {
          min-width: 80px;
        }

        mat-spinner {
          margin: 0 auto;
        }
      }

      .vendor-docs-link {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        margin-top: var(--spacing-sm);
        font-size: var(--font-size-sm);
        color: var(--status-info);
        text-decoration: none;

        &:hover {
          text-decoration: underline;
        }

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }
      }
    `,
  ],
})
export class SettingsPanelComponent implements OnInit, OnDestroy {
  readonly settingsService = inject(SettingsService);
  readonly aiState = inject(AIStateService);
  readonly settings = this.settingsService.settings;
  readonly copyKeyHint = keyHint('C');

  // Track API key inputs per vendor
  readonly apiKeyInputs = signal<Record<string, string>>({});

  private keydownHandler = (event: KeyboardEvent) => {
    // Cmd+, to toggle settings
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault();
      if (this.settingsService.isOpen()) {
        this.close();
      } else {
        this.settingsService.open();
      }
    }
  };

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.settingsService.isOpen()) {
      this.close();
    }
  }

  ngOnInit(): void {
    // Initialize AI state when panel opens
    this.aiState.initialize();
    document.addEventListener('keydown', this.keydownHandler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.keydownHandler);
  }

  close(): void {
    this.settingsService.close();
  }

  updateTheme(theme: ThemePreference): void {
    this.settingsService.updateTheme(theme);
  }

  updateEditorSetting<K extends keyof ReturnType<typeof this.settings>['editor']>(
    key: K,
    value: ReturnType<typeof this.settings>['editor'][K]
  ): void {
    this.settingsService.updateEditorSetting(key, value);
  }

  updateQuerySetting<K extends keyof ReturnType<typeof this.settings>['query']>(
    key: K,
    value: ReturnType<typeof this.settings>['query'][K]
  ): void {
    this.settingsService.updateQuerySetting(key, value);
  }

  updateGridSetting<K extends keyof ReturnType<typeof this.settings>['grid']>(
    key: K,
    value: ReturnType<typeof this.settings>['grid'][K]
  ): void {
    this.settingsService.updateGridSetting(key, value);
  }

  resetToDefaults(): void {
    this.settingsService.resetToDefaults();
  }

  // AI vendor helpers
  getVendorEnabled(vendorId: string): boolean {
    const vs = this.aiState.getVendorSettings(vendorId);
    return vs?.enabled ?? false;
  }

  getVendorConfigured(vendorId: string): boolean {
    const vs = this.aiState.getVendorSettings(vendorId);
    return vs?.apiKeyConfigured ?? false;
  }

  getPreferredModel(vendorId: string): string | undefined {
    const vs = this.aiState.getVendorSettings(vendorId);
    return vs?.preferredModelId;
  }

  updateApiKeyInput(vendorId: string, value: string): void {
    this.apiKeyInputs.update(inputs => ({ ...inputs, [vendorId]: value }));
  }

  async saveApiKey(vendorId: string): Promise<void> {
    const apiKey = this.apiKeyInputs()[vendorId];
    if (!apiKey) return;

    const success = await this.aiState.setApiKey(vendorId, apiKey);
    if (success) {
      // Clear the input after successful save
      this.apiKeyInputs.update(inputs => {
        const newInputs = { ...inputs };
        delete newInputs[vendorId];
        return newInputs;
      });
    }
  }

  async removeApiKey(vendorId: string): Promise<void> {
    await this.aiState.removeApiKey(vendorId);
  }
}
