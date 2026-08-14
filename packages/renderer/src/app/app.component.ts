import { Component, inject, OnInit, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { SharedGenericModule } from '@memberjunction/ng-shared-generic';
import { ShellComponent } from './layout/shell/shell.component';
import { ContextMenuComponent } from './shared/components/context-menu/context-menu.component';
import { SettingsPanelComponent } from './shared/components/settings-panel/settings-panel.component';
import { TablePropertiesContainerComponent } from './shared/components/table-properties-panel/table-properties-container.component';
import { CommandPaletteComponent } from './shared/components/command-palette/command-palette.component';
import { ObjectSearchComponent } from './shared/components/object-search/object-search.component';
import { ShortcutsDialogComponent } from './shared/components/shortcuts-dialog/shortcuts-dialog.component';
import { SnippetLibraryComponent } from './shared/components/snippet-library/snippet-library.component';
import { SettingsService } from './core/services/settings.service';
import { ConnectionStateService } from './core/state/connection.state';
import { TabStateService } from './core/state/tab.state';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    SharedGenericModule,
    ShellComponent,
    ContextMenuComponent,
    SettingsPanelComponent,
    TablePropertiesContainerComponent,
    CommandPaletteComponent,
    ObjectSearchComponent,
    ShortcutsDialogComponent,
    SnippetLibraryComponent,
  ],
  template: `
    @if (loading()) {
      <div class="startup-loading">
        <mj-loading [text]="loadingMessage()" size="large" animation="pulse"></mj-loading>
      </div>
    } @else {
      <app-shell />
      <app-context-menu />
      <app-settings-panel />
      <app-table-properties-container />
      <app-command-palette />
      <app-object-search />
      <app-shortcuts-dialog />
      <app-snippet-library />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100vh;
        width: 100vw;
        overflow: hidden;
      }

      .startup-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        width: 100%;
        background-color: var(--bg-primary, #1e1e1e);
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  // Inject settings service to ensure it's initialized early
  // Injected for its constructor side effects: applies the persisted theme
  // and wires the native-theme listener at app boot. Not read directly.
  private readonly settingsService = inject(SettingsService);
  private readonly connectionState = inject(ConnectionStateService);
  private readonly tabState = inject(TabStateService);
  private readonly iconRegistry = inject(MatIconRegistry);
  private readonly sanitizer = inject(DomSanitizer);

  // Loading state
  readonly loading = signal(true);
  readonly loadingMessage = signal('Starting Forge...');

  constructor() {
    // Register custom SVG icons
    this.iconRegistry.addSvgIcon(
      'database-cylinder',
      this.sanitizer.bypassSecurityTrustResourceUrl('assets/icons/database-cylinder.svg')
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    const hasDirtyTabs = this.tabState.tabs().some(tab => tab.isDirty);
    if (hasDirtyTabs) {
      event.preventDefault();
      // Modern browsers ignore custom messages but still show confirmation
      event.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    }
  }

  async ngOnInit(): Promise<void> {
    try {
      // Load connection profiles, then show the shell. Reconnecting saved
      // sessions is network-bound and must not hold the whole UI behind a
      // spinner — it continues in the background below, with progress
      // visible through the sidebar's per-connection status indicators.
      this.loadingMessage.set('Loading connections...');
      await this.connectionState.loadProfiles();
    } finally {
      // Always finish loading even if there's an error
      this.loading.set(false);
    }

    try {
      await this.connectionState.restoreState();

      // Restore tabs if we have a connection. Phase 8 will iterate over every
      // restored profile; today restoreState only reconnects one, so pick that.
      const restored = [...this.connectionState.connectedProfileIds()][0];
      if (restored) {
        await this.tabState.restoreTabs(restored);
      }
    } catch (error) {
      console.error('Background session restore failed:', error);
    }
  }
}
