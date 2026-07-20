import { Injectable, NgZone, inject } from '@angular/core';
import { Observable, Subject, from } from 'rxjs';
import type {
  ConnectionProfile,
  TestConnectionResult,
  DatabaseInfo,
  SchemaInfo,
  CreateDatabaseOptions,
  RenameDatabaseOptions,
  DeleteDatabaseOptions,
  DatabaseOperationResult,
  DockerStatus,
  DockerContainer,
  DockerVolume,
  QueryRequest,
  QueryResult,
  QueryHistoryEntry,
  QueryHistoryFilter,
  ExportOptions,
  ExportResult,
  ResultSet,
  FkRecordRequest,
  FkRecordResult,
  BackupRequest,
  RestoreRequest,
  BackupProgress,
  RestoreProgress,
  LogEntry,
  BackupFileInfo,
  BackupHistoryEntry,
  CliDepsResult,
  CliEngine,
  ObjectMetadata,
  ObjectType,
  ObjectDefinition,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  ConstraintInfo,
  TriggerInfo,
  ExtendedProperty,
  TableProperties,
  AppState,
  TabState,
  FileTreeNode,
  WorkspaceInfo,
  LayoutConfig,
  // Query results persistence types
  QueryResultSnapshot,
  QueryResultHistoryFilter,
  ResultHistorySortOptions,
  PurgeOptions,
  PurgeResult,
  ResultStorageStats,
  ResultDiff,
  DiffOptions,
  // AI types
  AIVendor,
  AISettings,
  TabRenameRequest,
  TabRenameResponse,
  AnalysisRequest,
  AnalysisResponse,
  SQLGenerationRequest,
  SQLGenerationResponse,
  // Chat types
  ChatRequest,
  ChatStreamChunk,
  Conversation,
  ToolDefinition,
  // Server file system types
  ServerDrive,
  ServerFileEntry,
  ServerDefaultPaths,
  // MemberJunction types
  MJDatabaseInfo,
  MJEntityInfo,
  MJEntityFieldInfo,
  MJApplicationInfo,
  MJRecordChange,
  MJAuditLog,
  MJQuery,
  MJErrorLog,
  MJUserRecordLog,
  MJEntityRelationship,
} from '@mj-forge/shared';

// Dialog types for Electron dialogs
export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: { name: string; extensions: string[] }[];
  properties?: Array<
    | 'openFile'
    | 'openDirectory'
    | 'multiSelections'
    | 'showHiddenFiles'
    | 'createDirectory'
    | 'promptToCreate'
  >;
  message?: string;
}

export interface OpenDialogReturnValue {
  canceled: boolean;
  filePaths: string[];
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
  filters?: { name: string; extensions: string[] }[];
  message?: string;
  nameFieldLabel?: string;
  showsTagField?: boolean;
}

export interface SaveDialogReturnValue {
  canceled: boolean;
  filePath?: string;
}

// Get the forge API from the preload script
declare global {
  interface Window {
    forge: ForgeAPI;
  }
}

interface ForgeAPI {
  connection: {
    test: (
      profile: ConnectionProfile,
      password?: string,
      sshPassword?: string,
      sshPassphrase?: string
    ) => Promise<TestConnectionResult>;
    save: (
      profile: ConnectionProfile,
      password?: string,
      sshPassword?: string,
      sshPassphrase?: string
    ) => Promise<ConnectionProfile>;
    delete: (profileId: string) => Promise<void>;
    list: () => Promise<ConnectionProfile[]>;
    connect: (profileId: string) => Promise<void>;
    disconnect: (profileId: string) => Promise<void>;
  };
  docker: {
    detect: () => Promise<DockerStatus>;
    getContainers: () => Promise<DockerContainer[]>;
    getVolumes: () => Promise<DockerVolume[]>;
    startContainer: (containerId: string) => Promise<void>;
    stopContainer: (containerId: string) => Promise<void>;
    createContainer: (options: {
      name: string;
      password: string;
      port: number;
      image?: string;
      acceptEula?: boolean;
    }) => Promise<{ success: boolean; containerId?: string; error?: string }>;
  };
  database: {
    list: (connectionId: string) => Promise<DatabaseInfo[]>;
    create: (
      connectionId: string,
      options: CreateDatabaseOptions
    ) => Promise<DatabaseOperationResult>;
    rename: (
      connectionId: string,
      options: RenameDatabaseOptions
    ) => Promise<DatabaseOperationResult>;
    delete: (
      connectionId: string,
      options: DeleteDatabaseOptions
    ) => Promise<DatabaseOperationResult>;
    getInfo: (connectionId: string, databaseName: string) => Promise<DatabaseInfo>;
  };
  explorer: {
    listSchemas: (connectionId: string, databaseName: string) => Promise<SchemaInfo[]>;
    getChildren: (
      connectionId: string,
      databaseName: string,
      parentPath: string
    ) => Promise<ObjectMetadata[]>;
    getObjectDetails: (
      connectionId: string,
      databaseName: string,
      objectType: ObjectType,
      objectName: string,
      schema?: string
    ) => Promise<ObjectMetadata>;
    refreshNode: (
      connectionId: string,
      databaseName: string,
      path: string
    ) => Promise<ObjectMetadata[]>;
    getDefinition: (
      connectionId: string,
      databaseName: string,
      schema: string,
      name: string,
      objectType: string
    ) => Promise<ObjectDefinition>;
    getTableColumns: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<ColumnInfo[]>;
    getTableIndexes: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<IndexInfo[]>;
    getTableKeys: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<ForeignKeyInfo[]>;
    getTableConstraints: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<ConstraintInfo[]>;
    getTableTriggers: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<TriggerInfo[]>;
    getTableProperties: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<TableProperties>;
    getExtendedProperties: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<ExtendedProperty[]>;
    scriptTableAsCreate: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<string>;
    scriptTableAsInsert: (
      connectionId: string,
      databaseName: string,
      schema: string,
      tableName: string
    ) => Promise<string>;
  };
  query: {
    execute: (request: QueryRequest) => Promise<QueryResult>;
    cancel: (queryId: string) => Promise<void>;
    getHistory: (filter?: QueryHistoryFilter) => Promise<QueryHistoryEntry[]>;
    clearHistory: () => Promise<void>;
    deleteHistoryEntry: (id: string) => Promise<boolean>;
    exportResults: (resultSet: ResultSet, options: ExportOptions) => Promise<ExportResult>;
    fetchFkRecord: (request: FkRecordRequest) => Promise<FkRecordResult>;
    convertSql: (
      sql: string,
      fromEngine: string,
      toEngine: string
    ) => Promise<{ success: boolean; sql: string; error?: string }>;
  };
  queryResults: {
    saveSnapshot: (
      tabId: string,
      sql: string,
      connectionId: string,
      database: string,
      result: QueryResult
    ) => Promise<QueryResultSnapshot>;
    getSnapshots: (
      filter?: QueryResultHistoryFilter,
      sort?: ResultHistorySortOptions
    ) => Promise<QueryResultSnapshot[]>;
    getSnapshot: (id: string) => Promise<QueryResultSnapshot | null>;
    deleteSnapshot: (id: string) => Promise<boolean>;
    deleteSnapshots: (ids: string[]) => Promise<number>;
    pinSnapshot: (id: string) => Promise<boolean>;
    unpinSnapshot: (id: string) => Promise<boolean>;
    labelSnapshot: (id: string, label: string) => Promise<boolean>;
    getStorageStats: () => Promise<ResultStorageStats>;
    purge: (options: PurgeOptions) => Promise<PurgeResult>;
    compareSnapshots: (
      baseId: string,
      compareId: string,
      options?: DiffOptions
    ) => Promise<ResultDiff | null>;
  };
  ai: {
    getVendors: () => Promise<AIVendor[]>;
    getSettings: () => Promise<AISettings>;
    setSettings: (settings: Partial<AISettings>) => Promise<AISettings>;
    setApiKey: (vendorId: string, apiKey: string) => Promise<boolean>;
    removeApiKey: (vendorId: string) => Promise<boolean>;
    validateApiKey: (vendorId: string, apiKey: string) => Promise<boolean>;
    generateTabName: (request: TabRenameRequest) => Promise<TabRenameResponse>;
    analyzeResults: (request: AnalysisRequest) => Promise<AnalysisResponse>;
    generateSQL: (request: SQLGenerationRequest) => Promise<SQLGenerationResponse>;
    cancelRequest: (requestId: string) => Promise<boolean>;
  };
  chat: {
    getTools: () => Promise<ToolDefinition[]>;
    listConversations: () => Promise<Conversation[]>;
    getConversation: (id: string) => Promise<Conversation | null>;
    createConversation: (title?: string) => Promise<Conversation>;
    deleteConversation: (id: string) => Promise<boolean>;
    renameConversation: (id: string, title: string) => Promise<Conversation | null>;
    sendMessage: (request: ChatRequest) => Promise<{ started: boolean }>;
    confirmTool: (
      conversationId: string,
      toolCallId: string,
      confirmed: boolean
    ) => Promise<{ confirmed: boolean }>;
    cancelStream: (conversationId: string) => Promise<{ cancelled: boolean }>;
    onStreamChunk: (callback: (chunk: ChatStreamChunk) => void) => () => void;
  };
  serverFs: {
    getDrives: (connectionId: string) => Promise<ServerDrive[]>;
    listDirectory: (
      connectionId: string,
      path: string,
      includeFiles?: boolean
    ) => Promise<ServerFileEntry[]>;
    getDefaultPaths: (connectionId: string) => Promise<ServerDefaultPaths>;
  };
  backup: {
    start: (request: BackupRequest) => Promise<void>;
    cancel: (backupId: string) => Promise<void>;
    getHistory: (connectionId: string, databaseName?: string) => Promise<BackupHistoryEntry[]>;
    onProgress: (callback: (progress: BackupProgress) => void) => () => void;
    checkTools: (engine: CliEngine) => Promise<CliDepsResult>;
    recheckTools: (engine: CliEngine) => Promise<CliDepsResult>;
  };
  restore: {
    start: (request: RestoreRequest) => Promise<void>;
    cancel: (restoreId: string) => Promise<void>;
    getFileList: (
      connectionId: string,
      backupPath: string
    ) => Promise<{ logicalName: string; physicalName: string; type: string }[]>;
    getBackupInfo: (connectionId: string, backupPath: string) => Promise<BackupFileInfo>;
    onProgress: (callback: (progress: RestoreProgress) => void) => () => void;
  };
  logs: {
    getRecent: (limit?: number) => Promise<LogEntry[]>;
    append: (entry: LogEntry) => Promise<void>;
    onEntry: (callback: (entry: LogEntry) => void) => () => void;
    revealFile: () => Promise<string>;
  };
  app: {
    getVersion: () => Promise<string>;
    openExternal: (url: string) => Promise<void>;
    showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
    showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogReturnValue>;
    // State persistence
    getState: () => Promise<AppState>;
    setState: (partial: Partial<AppState>) => Promise<void>;
    saveTabs: (tabs: TabState[], activeTabId: string | null) => Promise<void>;
    getTabs: () => Promise<{ tabs: TabState[]; activeTabId: string | null }>;
    // GoldenLayout persistence
    saveLayout: (config: LayoutConfig | undefined) => Promise<void>;
    getLayout: () => Promise<LayoutConfig | undefined>;
    // Atomic save-dialog + file write (main process shows dialog and writes)
    saveToFile: (
      options: SaveDialogOptions,
      content: string
    ) => Promise<{ canceled: boolean; filePath?: string }>;
  };
  workspace: {
    openFolder: (path: string) => Promise<WorkspaceInfo>;
    getFiles: (path: string) => Promise<FileTreeNode[]>;
    readFile: (filePath: string) => Promise<string>;
    writeFile: (filePath: string, content: string) => Promise<void>;
    createFile: (filePath: string, content?: string) => Promise<void>;
    deleteFile: (filePath: string) => Promise<void>;
    renameFile: (oldPath: string, newPath: string) => Promise<void>;
    onFileChanged: (callback: (event: { filePath: string; type: string }) => void) => () => void;
  };
  mj: {
    detect: (
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ) => Promise<MJDatabaseInfo>;
    getEntities: (
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ) => Promise<MJEntityInfo[]>;
    getEntityFields: (
      connectionId: string,
      database: string,
      entityId: string,
      mjSchemaName?: string
    ) => Promise<MJEntityFieldInfo[]>;
    getApplications: (
      connectionId: string,
      database: string,
      mjSchemaName?: string
    ) => Promise<MJApplicationInfo[]>;
    getEntityRelationships: (
      connectionId: string,
      database: string,
      entityId?: string,
      mjSchemaName?: string
    ) => Promise<MJEntityRelationship[]>;
    getRecordChanges: (
      connectionId: string,
      database: string,
      options?: { entityId?: string; entityName?: string; recordId?: string; limit?: number },
      mjSchemaName?: string
    ) => Promise<MJRecordChange[]>;
    getAuditLogs: (
      connectionId: string,
      database: string,
      options?: { entityId?: string; recordId?: string; userId?: string; limit?: number },
      mjSchemaName?: string
    ) => Promise<MJAuditLog[]>;
    getSavedQueries: (
      connectionId: string,
      database: string,
      categoryId?: string,
      mjSchemaName?: string
    ) => Promise<MJQuery[]>;
    getErrorLogs: (
      connectionId: string,
      database: string,
      options?: { category?: string; limit?: number },
      mjSchemaName?: string
    ) => Promise<MJErrorLog[]>;
    getUserRecordLogs: (
      connectionId: string,
      database: string,
      options?: { entityId?: string; recordId?: string; userId?: string; limit?: number },
      mjSchemaName?: string
    ) => Promise<MJUserRecordLog[]>;
  };
  menu: {
    onNewConnection: (callback: () => void) => () => void;
    onNewQuery: (callback: () => void) => () => void;
    onOpenQuery: (callback: () => void) => () => void;
    onCloseTab: (callback: () => void) => () => void;
    onSaveQuery: (callback: () => void) => () => void;
    onSaveQueryAs: (callback: () => void) => () => void;
    onExportResults: (callback: () => void) => () => void;
    onCopy: (callback: () => void) => () => void;
    onFind: (callback: () => void) => () => void;
    onReplace: (callback: () => void) => () => void;
    onFormatSql: (callback: () => void) => () => void;
    onToggleComment: (callback: () => void) => () => void;
    onExecuteQuery: (callback: () => void) => () => void;
    onExecuteSelection: (callback: () => void) => () => void;
    onCancelQuery: (callback: () => void) => () => void;
    onQueryHistory: (callback: () => void) => () => void;
    onDisconnect: (callback: () => void) => () => void;
    onRefresh: (callback: () => void) => () => void;
    onServerProperties: (callback: () => void) => () => void;
    onNewDatabase: (callback: () => void) => () => void;
    onBackup: (callback: () => void) => () => void;
    onRestore: (callback: () => void) => () => void;
    onDatabaseProperties: (callback: () => void) => () => void;
    onShowWelcome: (callback: () => void) => () => void;
    onToggleSidebar: (callback: () => void) => () => void;
    onToggleChat: (callback: () => void) => () => void;
    onToggleResults: (callback: () => void) => () => void;
    onNextTab: (callback: () => void) => () => void;
    onPreviousTab: (callback: () => void) => () => void;
    onOpenSettings: (callback: () => void) => () => void;
    onShowShortcuts: (callback: () => void) => () => void;
  };
}

@Injectable({ providedIn: 'root' })
export class IpcService {
  private readonly zone = inject(NgZone);
  private readonly backupProgress$ = new Subject<BackupProgress>();
  private readonly restoreProgress$ = new Subject<RestoreProgress>();
  private backupUnsubscribe?: () => void;
  private restoreUnsubscribe?: () => void;
  private _isAvailable = false;

  private get api(): ForgeAPI {
    if (!window.forge) {
      throw new Error('Forge API not available. Running outside Electron context?');
    }
    return window.forge;
  }

  get isAvailable(): boolean {
    return this._isAvailable;
  }

  constructor() {
    // Check if running in Electron context
    this._isAvailable = typeof window !== 'undefined' && !!window.forge;

    if (!this._isAvailable) {
      console.warn('IpcService: Forge API not available. Running in browser mode.');
      return;
    }

    try {
      // Subscribe to backup progress events
      this.backupUnsubscribe = this.api.backup.onProgress(progress => {
        this.zone.run(() => this.backupProgress$.next(progress));
      });

      // Subscribe to restore progress events
      this.restoreUnsubscribe = this.api.restore.onProgress(progress => {
        this.zone.run(() => this.restoreProgress$.next(progress));
      });
    } catch (error) {
      console.error('IpcService: Failed to initialize event listeners:', error);
    }
  }

  // Connection methods
  testConnection(
    profile: ConnectionProfile,
    password?: string,
    sshPassword?: string,
    sshPassphrase?: string
  ): Observable<TestConnectionResult> {
    return from(this.api.connection.test(profile, password, sshPassword, sshPassphrase));
  }

  saveConnection(
    profile: Partial<ConnectionProfile>,
    password?: string,
    sshPassword?: string,
    sshPassphrase?: string
  ): Observable<ConnectionProfile> {
    return from(
      this.api.connection.save(profile as ConnectionProfile, password, sshPassword, sshPassphrase)
    );
  }

  deleteConnection(profileId: string): Observable<void> {
    return from(this.api.connection.delete(profileId));
  }

  listConnections(): Observable<ConnectionProfile[]> {
    return from(this.api.connection.list());
  }

  connect(profileId: string): Observable<void> {
    return from(this.api.connection.connect(profileId));
  }

  disconnect(profileId: string): Observable<void> {
    return from(this.api.connection.disconnect(profileId));
  }

  // Docker methods
  detectDocker(): Observable<DockerStatus> {
    return from(this.api.docker.detect());
  }

  getDockerContainers(): Observable<DockerContainer[]> {
    return from(this.api.docker.getContainers());
  }

  getDockerVolumes(): Observable<DockerVolume[]> {
    return from(this.api.docker.getVolumes());
  }

  startDockerContainer(containerId: string): Observable<void> {
    return from(this.api.docker.startContainer(containerId));
  }

  stopDockerContainer(containerId: string): Observable<void> {
    return from(this.api.docker.stopContainer(containerId));
  }

  createDockerContainer(options: {
    name: string;
    password: string;
    port: number;
    image?: string;
    acceptEula?: boolean;
  }): Observable<{ success: boolean; containerId?: string; error?: string }> {
    return from(this.api.docker.createContainer(options));
  }

  // Database methods
  listDatabases(connectionId: string): Observable<DatabaseInfo[]> {
    return from(this.api.database.list(connectionId));
  }

  createDatabase(
    connectionId: string,
    options: CreateDatabaseOptions
  ): Observable<DatabaseOperationResult> {
    return from(this.api.database.create(connectionId, options));
  }

  renameDatabase(
    connectionId: string,
    options: RenameDatabaseOptions
  ): Observable<DatabaseOperationResult> {
    return from(this.api.database.rename(connectionId, options));
  }

  deleteDatabase(
    connectionId: string,
    options: DeleteDatabaseOptions
  ): Observable<DatabaseOperationResult> {
    return from(this.api.database.delete(connectionId, options));
  }

  getDatabaseInfo(connectionId: string, databaseName: string): Observable<DatabaseInfo> {
    return from(this.api.database.getInfo(connectionId, databaseName));
  }

  // Explorer methods
  listSchemas(connectionId: string, databaseName: string): Observable<SchemaInfo[]> {
    return from(this.api.explorer.listSchemas(connectionId, databaseName));
  }

  getExplorerChildren(
    connectionId: string,
    databaseName: string,
    parentPath: string
  ): Observable<ObjectMetadata[]> {
    return from(this.api.explorer.getChildren(connectionId, databaseName, parentPath));
  }

  getObjectDetails(
    connectionId: string,
    databaseName: string,
    objectType: ObjectType,
    objectName: string,
    schema?: string
  ): Observable<ObjectMetadata> {
    return from(
      this.api.explorer.getObjectDetails(connectionId, databaseName, objectType, objectName, schema)
    );
  }

  refreshExplorerNode(
    connectionId: string,
    databaseName: string,
    path: string
  ): Observable<ObjectMetadata[]> {
    return from(this.api.explorer.refreshNode(connectionId, databaseName, path));
  }

  getTableColumns(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<ColumnInfo[]> {
    return from(this.api.explorer.getTableColumns(connectionId, databaseName, schema, tableName));
  }

  getTableIndexes(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<IndexInfo[]> {
    return from(this.api.explorer.getTableIndexes(connectionId, databaseName, schema, tableName));
  }

  getTableKeys(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<ForeignKeyInfo[]> {
    return from(this.api.explorer.getTableKeys(connectionId, databaseName, schema, tableName));
  }

  getTableConstraints(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<ConstraintInfo[]> {
    return from(
      this.api.explorer.getTableConstraints(connectionId, databaseName, schema, tableName)
    );
  }

  getTableTriggers(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<TriggerInfo[]> {
    return from(this.api.explorer.getTableTriggers(connectionId, databaseName, schema, tableName));
  }

  getDefinition(
    connectionId: string,
    databaseName: string,
    objectType: string,
    name: string,
    schema: string
  ): Observable<ObjectDefinition> {
    return from(
      this.api.explorer.getDefinition(connectionId, databaseName, schema, name, objectType)
    );
  }

  scriptTableCreate(
    connectionId: string,
    databaseName: string,
    schema: string,
    tableName: string
  ): Observable<string> {
    return from(
      this.api.explorer.scriptTableAsCreate(connectionId, databaseName, schema, tableName)
    );
  }

  // Query methods
  executeQuery(request: QueryRequest): Observable<QueryResult> {
    return from(this.api.query.execute(request));
  }

  cancelQuery(queryId: string): Observable<void> {
    return from(this.api.query.cancel(queryId));
  }

  getQueryHistory(filter?: QueryHistoryFilter): Observable<QueryHistoryEntry[]> {
    return from(this.api.query.getHistory(filter));
  }

  clearQueryHistory(): Observable<void> {
    return from(this.api.query.clearHistory());
  }

  deleteQueryHistoryEntry(id: string): Observable<boolean> {
    return from(this.api.query.deleteHistoryEntry(id));
  }

  exportQueryResults(resultSet: ResultSet, options: ExportOptions): Observable<ExportResult> {
    return from(this.api.query.exportResults(resultSet, options));
  }

  fetchFkRecord(request: FkRecordRequest): Observable<FkRecordResult> {
    return from(this.api.query.fetchFkRecord(request));
  }

  convertSql(
    sql: string,
    fromEngine: string,
    toEngine: string
  ): Observable<{ success: boolean; sql: string; error?: string }> {
    return from(this.api.query.convertSql(sql, fromEngine, toEngine));
  }

  // Query Results Persistence methods
  saveResultSnapshot(
    tabId: string,
    sql: string,
    connectionId: string,
    database: string,
    result: QueryResult
  ): Observable<QueryResultSnapshot> {
    return from(this.api.queryResults.saveSnapshot(tabId, sql, connectionId, database, result));
  }

  getResultSnapshots(
    filter?: QueryResultHistoryFilter,
    sort?: ResultHistorySortOptions
  ): Observable<QueryResultSnapshot[]> {
    return from(this.api.queryResults.getSnapshots(filter, sort));
  }

  getResultSnapshot(id: string): Observable<QueryResultSnapshot | null> {
    return from(this.api.queryResults.getSnapshot(id));
  }

  deleteResultSnapshot(id: string): Observable<boolean> {
    return from(this.api.queryResults.deleteSnapshot(id));
  }

  deleteResultSnapshots(ids: string[]): Observable<number> {
    return from(this.api.queryResults.deleteSnapshots(ids));
  }

  pinResultSnapshot(id: string): Observable<boolean> {
    return from(this.api.queryResults.pinSnapshot(id));
  }

  unpinResultSnapshot(id: string): Observable<boolean> {
    return from(this.api.queryResults.unpinSnapshot(id));
  }

  labelResultSnapshot(id: string, label: string): Observable<boolean> {
    return from(this.api.queryResults.labelSnapshot(id, label));
  }

  getResultStorageStats(): Observable<ResultStorageStats> {
    return from(this.api.queryResults.getStorageStats());
  }

  purgeResultSnapshots(options: PurgeOptions): Observable<PurgeResult> {
    return from(this.api.queryResults.purge(options));
  }

  compareResultSnapshots(
    baseId: string,
    compareId: string,
    options?: DiffOptions
  ): Observable<ResultDiff | null> {
    return from(this.api.queryResults.compareSnapshots(baseId, compareId, options));
  }

  // Backup methods
  startBackup(request: BackupRequest): Observable<void> {
    return from(this.api.backup.start(request));
  }

  cancelBackup(backupId: string): Observable<void> {
    return from(this.api.backup.cancel(backupId));
  }

  getBackupProgress(): Observable<BackupProgress> {
    return this.backupProgress$.asObservable();
  }

  // Diagnostics / log stream methods. These are best-effort: when the bridge
  // isn't available (e.g. browser-only dev), they degrade to no-ops so the
  // Output panel and error capture don't crash the app.
  getRecentLogs(limit?: number): Promise<LogEntry[]> {
    if (!this._isAvailable) return Promise.resolve([]);
    return this.api.logs.getRecent(limit);
  }

  appendLog(entry: LogEntry): Promise<void> {
    if (!this._isAvailable) return Promise.resolve();
    return this.api.logs.append(entry);
  }

  onLogEntry(callback: (entry: LogEntry) => void): () => void {
    if (!this._isAvailable) return () => undefined;
    return this.api.logs.onEntry(callback);
  }

  revealLogFile(): Promise<string> {
    if (!this._isAvailable) return Promise.resolve('');
    return this.api.logs.revealFile();
  }

  // Restore methods
  startRestore(request: RestoreRequest): Observable<void> {
    return from(this.api.restore.start(request));
  }

  cancelRestore(restoreId: string): Observable<void> {
    return from(this.api.restore.cancel(restoreId));
  }

  getRestoreFileList(
    connectionId: string,
    backupPath: string
  ): Observable<{ logicalName: string; physicalName: string; type: string }[]> {
    return from(this.api.restore.getFileList(connectionId, backupPath));
  }

  getRestoreProgress(): Observable<RestoreProgress> {
    return this.restoreProgress$.asObservable();
  }

  getBackupInfo(connectionId: string, backupPath: string): Observable<BackupFileInfo> {
    return from(this.api.restore.getBackupInfo(connectionId, backupPath));
  }

  getBackupHistory(connectionId: string, databaseName?: string): Observable<BackupHistoryEntry[]> {
    return from(this.api.backup.getHistory(connectionId, databaseName));
  }

  // CLI tool dependency probe (PG/MySQL backup/restore)
  checkBackupTools(engine: CliEngine): Observable<CliDepsResult> {
    return from(this.api.backup.checkTools(engine));
  }

  recheckBackupTools(engine: CliEngine): Observable<CliDepsResult> {
    return from(this.api.backup.recheckTools(engine));
  }

  // Server file system methods
  getServerDrives(connectionId: string): Observable<ServerDrive[]> {
    return from(this.api.serverFs.getDrives(connectionId));
  }

  listServerDirectory(
    connectionId: string,
    path: string,
    includeFiles = true
  ): Observable<ServerFileEntry[]> {
    return from(this.api.serverFs.listDirectory(connectionId, path, includeFiles));
  }

  getServerDefaultPaths(connectionId: string): Observable<ServerDefaultPaths> {
    return from(this.api.serverFs.getDefaultPaths(connectionId));
  }

  // App methods
  getAppVersion(): Observable<string> {
    return from(this.api.app.getVersion());
  }

  openExternal(url: string): Observable<void> {
    return from(this.api.app.openExternal(url));
  }

  showOpenDialog(options: OpenDialogOptions): Observable<OpenDialogReturnValue> {
    return from(this.api.app.showOpenDialog(options));
  }

  showSaveDialog(options: SaveDialogOptions): Observable<SaveDialogReturnValue> {
    return from(this.api.app.showSaveDialog(options));
  }

  // State persistence methods
  getAppState(): Observable<AppState> {
    return from(this.api.app.getState());
  }

  setAppState(partial: Partial<AppState>): Observable<void> {
    return from(this.api.app.setState(partial));
  }

  saveTabs(tabs: TabState[], activeTabId: string | null): Observable<void> {
    return from(this.api.app.saveTabs(tabs, activeTabId));
  }

  getTabs(): Observable<{ tabs: TabState[]; activeTabId: string | null }> {
    return from(this.api.app.getTabs());
  }

  // GoldenLayout persistence
  saveLayout(config: LayoutConfig | undefined): Observable<void> {
    return from(this.api.app.saveLayout(config));
  }

  getLayout(): Observable<LayoutConfig | undefined> {
    return from(this.api.app.getLayout());
  }

  saveToFile(
    options: SaveDialogOptions,
    content: string
  ): Observable<{ canceled: boolean; filePath?: string }> {
    return from(this.api.app.saveToFile(options, content));
  }

  // Workspace methods
  openWorkspaceFolder(path: string): Observable<WorkspaceInfo> {
    return from(this.api.workspace.openFolder(path));
  }

  getWorkspaceFiles(path: string): Observable<FileTreeNode[]> {
    return from(this.api.workspace.getFiles(path));
  }

  readWorkspaceFile(filePath: string): Observable<string> {
    return from(this.api.workspace.readFile(filePath));
  }

  writeWorkspaceFile(filePath: string, content: string): Observable<void> {
    return from(this.api.workspace.writeFile(filePath, content));
  }

  createWorkspaceFile(filePath: string, content?: string): Observable<void> {
    return from(this.api.workspace.createFile(filePath, content));
  }

  deleteWorkspaceFile(filePath: string): Observable<void> {
    return from(this.api.workspace.deleteFile(filePath));
  }

  renameWorkspaceFile(oldPath: string, newPath: string): Observable<void> {
    return from(this.api.workspace.renameFile(oldPath, newPath));
  }

  // ============================================================
  // MemberJunction Detection Methods
  // ============================================================

  /**
   * Detect if a database has MemberJunction installed
   */
  detectMJDatabase(
    connectionId: string,
    database: string,
    mjSchemaName?: string
  ): Observable<MJDatabaseInfo> {
    return from(this.api.mj.detect(connectionId, database, mjSchemaName));
  }

  /**
   * Get MJ entities from a database
   */
  getMJEntities(
    connectionId: string,
    database: string,
    mjSchemaName?: string
  ): Observable<MJEntityInfo[]> {
    return from(this.api.mj.getEntities(connectionId, database, mjSchemaName));
  }

  /**
   * Get MJ entity fields
   */
  getMJEntityFields(
    connectionId: string,
    database: string,
    entityId: string,
    mjSchemaName?: string
  ): Observable<MJEntityFieldInfo[]> {
    return from(this.api.mj.getEntityFields(connectionId, database, entityId, mjSchemaName));
  }

  /**
   * Get MJ applications
   */
  getMJApplications(
    connectionId: string,
    database: string,
    mjSchemaName?: string
  ): Observable<MJApplicationInfo[]> {
    return from(this.api.mj.getApplications(connectionId, database, mjSchemaName));
  }

  /**
   * Get MJ entity relationships
   */
  getMJEntityRelationships(
    connectionId: string,
    database: string,
    entityId?: string,
    mjSchemaName?: string
  ): Observable<MJEntityRelationship[]> {
    return from(this.api.mj.getEntityRelationships(connectionId, database, entityId, mjSchemaName));
  }

  /**
   * Get MJ record changes (change history)
   */
  getMJRecordChanges(
    connectionId: string,
    database: string,
    options?: { entityId?: string; entityName?: string; recordId?: string; limit?: number },
    mjSchemaName?: string
  ): Observable<MJRecordChange[]> {
    return from(this.api.mj.getRecordChanges(connectionId, database, options, mjSchemaName));
  }

  /**
   * Get MJ audit logs
   */
  getMJAuditLogs(
    connectionId: string,
    database: string,
    options?: { entityId?: string; recordId?: string; userId?: string; limit?: number },
    mjSchemaName?: string
  ): Observable<MJAuditLog[]> {
    return from(this.api.mj.getAuditLogs(connectionId, database, options, mjSchemaName));
  }

  /**
   * Get MJ saved queries
   */
  getMJSavedQueries(
    connectionId: string,
    database: string,
    categoryId?: string,
    mjSchemaName?: string
  ): Observable<MJQuery[]> {
    return from(this.api.mj.getSavedQueries(connectionId, database, categoryId, mjSchemaName));
  }

  /**
   * Get MJ error logs
   */
  getMJErrorLogs(
    connectionId: string,
    database: string,
    options?: { category?: string; limit?: number },
    mjSchemaName?: string
  ): Observable<MJErrorLog[]> {
    return from(this.api.mj.getErrorLogs(connectionId, database, options, mjSchemaName));
  }

  /**
   * Get MJ user record logs
   */
  getMJUserRecordLogs(
    connectionId: string,
    database: string,
    options?: { entityId?: string; recordId?: string; userId?: string; limit?: number },
    mjSchemaName?: string
  ): Observable<MJUserRecordLog[]> {
    return from(this.api.mj.getUserRecordLogs(connectionId, database, options, mjSchemaName));
  }

  // AI methods
  getAIVendors(): Observable<AIVendor[]> {
    return from(this.api.ai.getVendors());
  }

  getAISettings(): Observable<AISettings> {
    return from(this.api.ai.getSettings());
  }

  setAISettings(settings: Partial<AISettings>): Observable<AISettings> {
    return from(this.api.ai.setSettings(settings));
  }

  setAIApiKey(vendorId: string, apiKey: string): Observable<boolean> {
    return from(this.api.ai.setApiKey(vendorId, apiKey));
  }

  removeAIApiKey(vendorId: string): Observable<boolean> {
    return from(this.api.ai.removeApiKey(vendorId));
  }

  validateAIApiKey(vendorId: string, apiKey: string): Observable<boolean> {
    return from(this.api.ai.validateApiKey(vendorId, apiKey));
  }

  generateTabName(request: TabRenameRequest): Observable<TabRenameResponse> {
    return from(this.api.ai.generateTabName(request));
  }

  analyzeResults(request: AnalysisRequest): Observable<AnalysisResponse> {
    return from(this.api.ai.analyzeResults(request));
  }

  generateSQL(request: SQLGenerationRequest): Observable<SQLGenerationResponse> {
    return from(this.api.ai.generateSQL(request));
  }

  cancelAIRequest(requestId: string): Observable<boolean> {
    return from(this.api.ai.cancelRequest(requestId));
  }

  // Chat methods
  getChatTools(): Observable<ToolDefinition[]> {
    return from(this.api.chat.getTools());
  }

  listConversations(): Observable<Conversation[]> {
    return from(this.api.chat.listConversations());
  }

  getConversation(id: string): Observable<Conversation | null> {
    return from(this.api.chat.getConversation(id));
  }

  createConversation(title?: string): Observable<Conversation> {
    return from(this.api.chat.createConversation(title));
  }

  deleteConversation(id: string): Observable<boolean> {
    return from(this.api.chat.deleteConversation(id));
  }

  renameConversation(id: string, title: string): Observable<Conversation | null> {
    return from(this.api.chat.renameConversation(id, title));
  }

  sendChatMessage(request: ChatRequest): Observable<{ started: boolean }> {
    return from(this.api.chat.sendMessage(request));
  }

  confirmChatTool(
    conversationId: string,
    toolCallId: string,
    confirmed: boolean
  ): Observable<{ confirmed: boolean }> {
    return from(this.api.chat.confirmTool(conversationId, toolCallId, confirmed));
  }

  cancelChatStream(conversationId: string): Observable<{ cancelled: boolean }> {
    return from(this.api.chat.cancelStream(conversationId));
  }

  onChatStreamChunk(callback: (chunk: ChatStreamChunk) => void): () => void {
    return this.api.chat.onStreamChunk((chunk: ChatStreamChunk) => {
      this.zone.run(() => callback(chunk));
    });
  }
}
