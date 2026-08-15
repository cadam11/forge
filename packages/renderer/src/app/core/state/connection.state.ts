import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FULL_CAPABILITIES } from '@joinery/shared';
import type {
  ConnectionProfile,
  DatabaseInfo,
  AppState,
  TestConnectionResult,
} from '@joinery/shared';
import { IpcService } from '../services/ipc.service';
import { NotificationService } from '../services/notification.service';
import { ExplorerStateService } from './explorer.state';
import { TabStateService } from './tab.state';
import { CapabilitiesStore } from './capabilities.state';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ConnectionStateService implements OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly notification = inject(NotificationService);
  private readonly explorerState = inject(ExplorerStateService);
  private readonly tabState = inject(TabStateService);
  private readonly capabilitiesStore = inject(CapabilitiesStore);

  private readonly _profiles = signal<ConnectionProfile[]>([]);
  private readonly _connecting = signal(false);
  private readonly _loadingDatabases = signal(false);

  // Multi-connection state. Authoritative answer to "what is connected" and the
  // per-id resources that track each connection's lifecycle.
  private readonly _connectedProfileIds = signal<ReadonlySet<string>>(new Set());
  private readonly _databasesByConnection = signal<ReadonlyMap<string, DatabaseInfo[]>>(new Map());
  private readonly _selectedDatabaseByConnection = signal<ReadonlyMap<string, string | null>>(
    new Map()
  );
  private readonly _heartbeatByConnection = new Map<string, ReturnType<typeof setInterval>>();
  private readonly _reconnectingByConnection = new Set<string>();
  private readonly _consecutiveFailuresByConnection = new Map<string, number>();
  private readonly _healthByConnection = signal<ReadonlyMap<string, boolean>>(new Map());

  // Heartbeat tuning. 30s tick interval; each tick has 10s to complete its IPC
  // call before being treated as a failure (strictly less than INTERVAL so ticks
  // can't overlap). After 3 consecutive failures we stop the heartbeat for that
  // connection and surface a notification — bounded retry per CLAUDE.md.
  private static readonly HEARTBEAT_INTERVAL_MS = 30_000;
  private static readonly HEARTBEAT_TICK_TIMEOUT_MS = 10_000;
  private static readonly HEARTBEAT_MAX_CONSECUTIVE_FAILURES = 3;

  readonly profiles = this._profiles.asReadonly();
  readonly connecting = this._connecting.asReadonly();
  readonly loadingDatabases = this._loadingDatabases.asReadonly();
  readonly connectedProfileIds = this._connectedProfileIds.asReadonly();

  readonly hasProfiles = computed(() => this._profiles().length > 0);

  // True when at least one connection is open. The sidebar tree visibility key.
  readonly hasAnyConnection = computed(() => this._connectedProfileIds().size > 0);

  // Focus is derived from the active query tab — never set directly. When the active
  // tab is null or non-query, focus is null and the cloud icon shows disconnected.
  readonly focusedConnectionId = computed(() => {
    const tab = this.tabState.activeTab();
    if (!tab || tab.type !== 'query') return null;
    return tab.connectionId ?? null;
  });

  readonly focusedDatabaseName = computed(() => {
    const tab = this.tabState.activeTab();
    if (!tab || tab.type !== 'query') return null;
    return tab.databaseName ?? null;
  });

  // The connection a user-driven action like Cmd+N should target by default.
  // Three-stage resolution:
  //   1. The currently-focused query tab's connection — what they're "in".
  //   2. The most-recently-opened query tab whose connection is still live.
  //      Set iteration order in `tabState.tabs()` is creation order, so the
  //      last query tab is the one the user most recently spawned. Survives
  //      the user closing the active tab as long as they have other tabs
  //      against the same connection.
  //   3. Most-recently-added entry of `_connectedProfileIds` (last connect()).
  // Returns null only when nothing is connected.
  readonly mostRecentConnectionId = computed<string | null>(() => {
    const focused = this.focusedConnectionId();
    if (focused && this._connectedProfileIds().has(focused)) return focused;

    const tabs = this.tabState.tabs();
    for (let i = tabs.length - 1; i >= 0; i--) {
      const tab = tabs[i];
      if (
        tab.type === 'query' &&
        tab.connectionId &&
        this._connectedProfileIds().has(tab.connectionId)
      ) {
        return tab.connectionId;
      }
    }

    const ids = [...this._connectedProfileIds()];
    return ids.length > 0 ? ids[ids.length - 1] : null;
  });

  readonly profiles$ = toObservable(this.profiles);
  readonly isConnected$ = toObservable(this.hasAnyConnection);

  isConnected(connectionId: string): boolean {
    return this._connectedProfileIds().has(connectionId);
  }

  databasesFor(connectionId: string | null): DatabaseInfo[] {
    if (!connectionId) return [];
    return this._databasesByConnection().get(connectionId) ?? [];
  }

  selectedDatabaseFor(connectionId: string | null): string | null {
    if (!connectionId) return null;
    return this._selectedDatabaseByConnection().get(connectionId) ?? null;
  }

  healthFor(connectionId: string | null): boolean {
    if (!connectionId) return true;
    // Absent entry = treat as healthy (no heartbeat result yet).
    return this._healthByConnection().get(connectionId) ?? true;
  }

  profileFor(connectionId: string | null): ConnectionProfile | null {
    if (!connectionId) return null;
    return this._profiles().find(p => p.id === connectionId) ?? null;
  }

  // The database a "new query" action should target for this connection.
  // Resolution order:
  //   1. The user's last-selected database for this connection.
  //   2. The profile's configured default database (if it's actually in the
  //      loaded list — guards against a stale profile.database value pointing
  //      at a now-deleted db).
  //   3. The first database the server returned, as a last-resort default.
  // Returns null only when the connection has zero databases.
  defaultDatabaseFor(connectionId: string): string | null {
    const selected = this.selectedDatabaseFor(connectionId);
    if (selected) return selected;
    const profile = this.profileFor(connectionId);
    const databases = this.databasesFor(connectionId);
    if (profile?.database && databases.some(d => d.name === profile.database)) {
      return profile.database;
    }
    return databases[0]?.name ?? null;
  }

  async loadProfiles(): Promise<void> {
    try {
      const profiles = await firstValueFrom(this.ipc.listConnections());
      this._profiles.set(profiles);
    } catch (error) {
      this.notification.error('Failed to load connection profiles');
      console.error('Failed to load profiles:', error);
    }
  }

  async saveProfile(
    profile: Partial<ConnectionProfile>,
    password?: string,
    sshPassword?: string,
    sshPassphrase?: string
  ): Promise<ConnectionProfile | null> {
    try {
      const savedProfile = await firstValueFrom(
        this.ipc.saveConnection(profile, password, sshPassword, sshPassphrase)
      );
      await this.loadProfiles();
      this.notification.success('Connection saved successfully');
      return savedProfile;
    } catch (error) {
      // Main-process errors (e.g. duplicate-name rejection) carry a useful
      // user-facing message; surface it instead of the generic fallback so
      // users know how to fix the problem.
      const message = error instanceof Error ? error.message : null;
      this.notification.error(message || 'Failed to save connection');
      console.error('Failed to save profile:', error);
      return null;
    }
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    try {
      if (this._connectedProfileIds().has(profileId)) {
        await this.disconnect(profileId);
      }
      await firstValueFrom(this.ipc.deleteConnection(profileId));
      await this.loadProfiles();
      this.notification.success('Connection deleted');
      return true;
    } catch (error) {
      this.notification.error('Failed to delete connection');
      console.error('Failed to delete profile:', error);
      return false;
    }
  }

  /**
   * Always resolves with a full TestConnectionResult (incl. error code +
   * guidance) so callers can render details inline; an IPC-level throw is
   * folded into a synthesized failure rather than a separate null shape.
   * Callers that render failures themselves pass notifyErrors: false to
   * suppress the error toast (the success toast always fires).
   */
  async testConnection(
    profile: ConnectionProfile,
    password?: string,
    sshPassword?: string,
    sshPassphrase?: string,
    opts: { notifyErrors?: boolean } = {}
  ): Promise<TestConnectionResult> {
    const notifyErrors = opts.notifyErrors ?? true;
    try {
      this._connecting.set(true);
      const result = await firstValueFrom(
        this.ipc.testConnection(profile, password, sshPassword, sshPassphrase)
      );
      if (result.success) {
        this.notification.success(`Connected to ${result.serverVersion || 'SQL Server'}`);
      } else if (notifyErrors) {
        this.notification.error(result.error || 'Connection failed');
      }
      return result;
    } catch (error) {
      if (notifyErrors) {
        this.notification.error('Connection test failed');
      }
      console.error('Connection test failed:', error);
      return { success: false, error: 'Connection test failed' };
    } finally {
      this._connecting.set(false);
    }
  }

  async connect(profileId: string): Promise<boolean> {
    const profile = this._profiles().find(p => p.id === profileId);
    if (!profile) {
      this.notification.error('Connection profile not found');
      return false;
    }

    try {
      this._connecting.set(true);
      const active = await firstValueFrom(this.ipc.connect(profileId));
      this.capabilitiesStore.set(profileId, {
        capabilities: active?.capabilities ?? FULL_CAPABILITIES,
        variant: active?.engineVariant,
      });
      this.addConnectedProfileId(profileId);
      this.setHealth(profileId, true);
      this.notification.success(`Connected to ${profile.name}`);
      await this.loadDatabases(profileId);
      this.saveState();
      this.startHeartbeat(profileId);
      return true;
    } catch (error) {
      this.notification.error('Failed to connect');
      console.error('Failed to connect:', error);
      return false;
    } finally {
      this._connecting.set(false);
    }
  }

  // Disconnect the connection identified by `connectionId`. No default — calling
  // bare `disconnect()` is a TypeScript compile error (spec scenario:
  // "Calling disconnect without an argument is a type error"). Other open
  // connections — heartbeats, caches, server nodes — are untouched.
  async disconnect(connectionId: string): Promise<void> {
    if (!this._connectedProfileIds().has(connectionId)) return;

    try {
      await firstValueFrom(this.ipc.disconnect(connectionId));
    } catch (error) {
      console.error('Error disconnecting:', error);
    }

    this.cleanupConnectionState(connectionId);
    this.notification.info('Disconnected');
    this.saveState();
  }

  async loadDatabases(connectionId: string): Promise<void> {
    try {
      this._loadingDatabases.set(true);
      const databases = await firstValueFrom(this.ipc.listDatabases(connectionId));
      this.setDatabasesFor(connectionId, databases);
    } catch (error) {
      this.notification.error('Failed to load databases');
      console.error('Failed to load databases:', error);
    } finally {
      this._loadingDatabases.set(false);
    }
  }

  /**
   * Get databases for any connection (cached, fetched on demand).
   * Used by per-tab database selectors that may reference non-focused connections.
   */
  async getDatabasesForConnection(connectionId: string): Promise<DatabaseInfo[]> {
    const cached = this._databasesByConnection().get(connectionId);
    if (cached) return cached;

    const databases = await firstValueFrom(this.ipc.listDatabases(connectionId));
    this.setDatabasesFor(connectionId, databases);
    return databases;
  }

  clearDatabaseCache(connectionId: string): void {
    this.deleteDatabasesFor(connectionId);
  }

  selectDatabase(connectionId: string, name: string | null): void {
    this.setSelectedDatabaseFor(connectionId, name);
    this.saveState();
  }

  getProfile(id: string): ConnectionProfile | undefined {
    return this._profiles().find(p => p.id === id);
  }

  // Hard cap on how many profiles we will attempt to reconnect on launch.
  // 20 is well above any realistic user count; the cap is a CLAUDE.md
  // "bound every loop" guard against pathological persisted state. If a user
  // legitimately needs more, raise this — but it likely indicates a bug.
  private static readonly MAX_RESTORE_CONNECTIONS = 20;

  /**
   * Initialize state from saved app state. Called on app startup.
   * Forward-migrates the legacy `lastConnectionId` to `lastConnectedProfileIds`
   * on first launch after the multi-connection upgrade.
   */
  async restoreState(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const state = await firstValueFrom(this.ipc.getAppState());
      const idsToRestore = this.resolveProfileIdsToRestore(state);
      if (idsToRestore.length === 0) return;

      if (this._profiles().length === 0) {
        await this.loadProfiles();
      }

      await this.reconnectProfiles(idsToRestore);
    } catch (error) {
      console.error('Failed to restore connection state:', error);
      this.notification.warning('Could not restore previous connections');
    }
  }

  // Prefer the new key. If it's absent (legacy state from before the upgrade)
  // and the deprecated single-id key is set, treat it as a one-element list.
  // Cap the result so a corrupted-or-malicious persisted state cannot trigger
  // an unbounded reconnect loop.
  private resolveProfileIdsToRestore(state: AppState): string[] {
    const fromNewKey = state.lastConnectedProfileIds ?? [];
    if (fromNewKey.length > 0) {
      return fromNewKey.slice(0, ConnectionStateService.MAX_RESTORE_CONNECTIONS);
    }
    const legacyId = this.readLegacyConnectionId(state);
    return legacyId ? [legacyId] : [];
  }

  // Single-purpose accessor for the legacy `lastConnectionId` field. Localised
  // here so the migration read appears in exactly one place — this is the only
  // path that reads the legacy single-connection persistence key, and it exists
  // only for forward-migration on first launch after the multi-connection upgrade.
  private readLegacyConnectionId(state: AppState): string | null {
    return state.lastConnectionId ?? null;
  }

  // Reconnect each profile independently — Promise.allSettled so a single
  // failed reconnect doesn't block the others. Each successful connect adds
  // its server node to the explorer; failures surface via the notification
  // path (connect() already handles its own error toast).
  private async reconnectProfiles(profileIds: string[]): Promise<void> {
    const profiles = this._profiles();
    const tasks = profileIds.map(async id => {
      const profile = profiles.find(p => p.id === id);
      if (!profile) return { id, ok: false, reason: 'profile-missing' as const };
      const connected = await this.connect(id);
      if (!connected) return { id, ok: false, reason: 'connect-failed' as const };
      this.explorerState.addServerNode(id, profile.name);
      this.explorerState.expandNode(`server-${id}`);
      return { id, ok: true as const };
    });
    const results = await Promise.allSettled(tasks);
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('Failed to restore connection:', r.reason);
      }
    }
  }

  // Start a per-connection heartbeat. Idempotent — restarting an existing
  // heartbeat for the same id replaces the prior interval handle. Each tick
  // is bounded by HEARTBEAT_TICK_TIMEOUT_MS; consecutive failures are capped
  // at HEARTBEAT_MAX_CONSECUTIVE_FAILURES, after which we stop the heartbeat
  // and surface a notification.
  private startHeartbeat(connectionId: string): void {
    this.stopHeartbeat(connectionId);
    this.setHealth(connectionId, true);
    this._consecutiveFailuresByConnection.set(connectionId, 0);
    const handle = setInterval(
      () => void this.heartbeatTick(connectionId),
      ConnectionStateService.HEARTBEAT_INTERVAL_MS
    );
    this._heartbeatByConnection.set(connectionId, handle);
  }

  private stopHeartbeat(connectionId: string): void {
    const handle = this._heartbeatByConnection.get(connectionId);
    if (handle) {
      clearInterval(handle);
      this._heartbeatByConnection.delete(connectionId);
    }
    this._reconnectingByConnection.delete(connectionId);
    this._consecutiveFailuresByConnection.delete(connectionId);
  }

  private async heartbeatTick(connectionId: string): Promise<void> {
    // Reentrancy guard: if a previous tick is still mid-reconnect, skip this one.
    if (this._reconnectingByConnection.has(connectionId)) return;
    // If the connection has been removed since the interval was scheduled, stop.
    if (!this._connectedProfileIds().has(connectionId)) {
      this.stopHeartbeat(connectionId);
      return;
    }

    const ok = await this.pingConnection(connectionId);
    if (ok) {
      this.setHealth(connectionId, true);
      this._consecutiveFailuresByConnection.set(connectionId, 0);
      return;
    }

    this.setHealth(connectionId, false);
    await this.attemptReconnect(connectionId);
  }

  private async pingConnection(connectionId: string): Promise<boolean> {
    try {
      await this.withTimeout(
        firstValueFrom(this.ipc.pingConnection(connectionId)),
        ConnectionStateService.HEARTBEAT_TICK_TIMEOUT_MS,
        `heartbeat ping for ${connectionId}`
      );
      return true;
    } catch (error) {
      console.warn(`Heartbeat ping failed for ${connectionId}:`, error);
      return false;
    }
  }

  // Single retry attempt per failed tick. After MAX_CONSECUTIVE_FAILURES the
  // heartbeat stops itself and the user is notified — bounded retry per CLAUDE.md.
  private async attemptReconnect(connectionId: string): Promise<void> {
    this._reconnectingByConnection.add(connectionId);
    try {
      // Capabilities are deliberately not re-synced here: they're set on the
      // initial connect() and stable per profile, and are only cleared on disconnect.
      await this.withTimeout(
        firstValueFrom(this.ipc.connect(connectionId)),
        ConnectionStateService.HEARTBEAT_TICK_TIMEOUT_MS,
        `heartbeat reconnect for ${connectionId}`
      );
      this.setHealth(connectionId, true);
      this._consecutiveFailuresByConnection.set(connectionId, 0);
      this.notification.info('Connection restored');
    } catch (error) {
      console.warn(`Heartbeat reconnect failed for ${connectionId}:`, error);
      const failures = (this._consecutiveFailuresByConnection.get(connectionId) ?? 0) + 1;
      this._consecutiveFailuresByConnection.set(connectionId, failures);
      if (failures >= ConnectionStateService.HEARTBEAT_MAX_CONSECUTIVE_FAILURES) {
        const profileName = this.profileFor(connectionId)?.name ?? connectionId;
        this.notification.error(
          `Lost connection to ${profileName} after ${failures} attempts. Reconnect manually to retry.`
        );
        this.stopHeartbeat(connectionId);
      }
    } finally {
      this._reconnectingByConnection.delete(connectionId);
    }
  }

  // Bounds an async operation by racing it against a timer. Rejects if the
  // operation does not settle within `ms`; the underlying promise is left to
  // resolve/reject on its own (best-effort — the IPC API has no cancellation).
  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Service-shutdown teardown. Angular fires ngOnDestroy on root-providers when
  // the platform is destroyed (e.g., window close / hot-reload). Every interval
  // handle owned by this service must be cleared here so timers don't outlive
  // the renderer process unexpectedly.
  ngOnDestroy(): void {
    for (const handle of this._heartbeatByConnection.values()) {
      clearInterval(handle);
    }
    this._heartbeatByConnection.clear();
    this._reconnectingByConnection.clear();
    this._consecutiveFailuresByConnection.clear();
  }

  /**
   * Persist the set of currently-connected profile ids. Per-tab `(connectionId,
   * databaseName)` is persisted independently by TabStateService; the legacy
   * `lastDatabase` global key is no longer written here (Phase 9 removal).
   */
  async saveState(): Promise<void> {
    if (!this.ipc.isAvailable) return;

    try {
      const stateUpdate: Partial<AppState> = {
        lastConnectedProfileIds: Array.from(this._connectedProfileIds()),
      };
      await firstValueFrom(this.ipc.setAppState(stateUpdate));
    } catch (error) {
      console.error('Failed to save connection state:', error);
    }
  }

  // Per-connection signal-map helpers — encapsulated to keep call sites linear.
  // Signals require a fresh reference to fire change detection; clone-on-write.

  private addConnectedProfileId(connectionId: string): void {
    this._connectedProfileIds.update(prev => {
      if (prev.has(connectionId)) return prev;
      const next = new Set(prev);
      next.add(connectionId);
      return next;
    });
  }

  private removeConnectedProfileId(connectionId: string): void {
    this._connectedProfileIds.update(prev => {
      if (!prev.has(connectionId)) return prev;
      const next = new Set(prev);
      next.delete(connectionId);
      return next;
    });
  }

  private setDatabasesFor(connectionId: string, databases: DatabaseInfo[]): void {
    this._databasesByConnection.update(prev => {
      const next = new Map(prev);
      next.set(connectionId, databases);
      return next;
    });
  }

  /**
   * Direct mutators for the per-connection database list. Use these from
   * CRUD handlers (create / drop / rename / restore) when the operation
   * succeeded and we know the new state — they avoid the IPC round-trip
   * of loadDatabases() and let the picker / sidebar tree update
   * synchronously. On *failure* the caller should fall back to
   * loadDatabases() to re-sync from the server. All three are
   * idempotent: adding an existing name is a no-op, removing a missing
   * name is a no-op, renaming a missing name is a no-op.
   */
  addDatabaseLocal(connectionId: string, info: DatabaseInfo): void {
    this._databasesByConnection.update(prev => {
      const current = prev.get(connectionId) ?? [];
      if (current.some(d => d.name === info.name)) return prev;
      const next = new Map(prev);
      next.set(connectionId, [...current, info]);
      return next;
    });
  }

  removeDatabaseLocal(connectionId: string, name: string): void {
    this._databasesByConnection.update(prev => {
      const current = prev.get(connectionId);
      if (!current || !current.some(d => d.name === name)) return prev;
      const next = new Map(prev);
      next.set(
        connectionId,
        current.filter(d => d.name !== name)
      );
      return next;
    });
  }

  renameDatabaseLocal(connectionId: string, oldName: string, newName: string): void {
    this._databasesByConnection.update(prev => {
      const current = prev.get(connectionId);
      if (!current || !current.some(d => d.name === oldName)) return prev;
      const next = new Map(prev);
      next.set(
        connectionId,
        current.map(d => (d.name === oldName ? { ...d, name: newName } : d))
      );
      return next;
    });
  }

  private deleteDatabasesFor(connectionId: string): void {
    this._databasesByConnection.update(prev => {
      if (!prev.has(connectionId)) return prev;
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
  }

  private setSelectedDatabaseFor(connectionId: string, name: string | null): void {
    this._selectedDatabaseByConnection.update(prev => {
      const next = new Map(prev);
      next.set(connectionId, name);
      return next;
    });
  }

  private deleteSelectedDatabaseFor(connectionId: string): void {
    this._selectedDatabaseByConnection.update(prev => {
      if (!prev.has(connectionId)) return prev;
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
  }

  private setHealth(connectionId: string, healthy: boolean): void {
    this._healthByConnection.update(prev => {
      const next = new Map(prev);
      next.set(connectionId, healthy);
      return next;
    });
  }

  private deleteHealth(connectionId: string): void {
    this._healthByConnection.update(prev => {
      if (!prev.has(connectionId)) return prev;
      const next = new Map(prev);
      next.delete(connectionId);
      return next;
    });
  }

  // Strictly per-connection teardown — touches only the targeted id's state.
  // Legacy singleton clears live in `disconnect()` itself, gated on whether
  // the disconnected id was the focused one. Both happy and error paths in
  // `disconnect()` route here so per-connection resources never leak.
  private cleanupConnectionState(connectionId: string): void {
    this.removeConnectedProfileId(connectionId);
    this.clearDatabaseCache(connectionId);
    this.deleteSelectedDatabaseFor(connectionId);
    this.deleteHealth(connectionId);
    this.stopHeartbeat(connectionId);
    this.explorerState.removeServerNode(connectionId);
    this.capabilitiesStore.clear(connectionId);
  }
}
