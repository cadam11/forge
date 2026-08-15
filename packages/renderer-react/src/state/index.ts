/**
 * The stores, ported from `packages/renderer/src/app/core/state/*` and
 * `core/services/{settings,theme}.service.ts`.
 *
 * Read the conventions block at the top of `capabilities.ts` before adding one: factory plus
 * singleton, derived values as exported selectors, always subscribe through a selector, and
 * clone-on-write. `selector-isolation.spec.tsx` is the executable version of rule 3.
 *
 * The dependency graph is a DAG and importing this barrel constructs all of it:
 *
 *   capabilities → explorer → connection → chat
 *                       tab ↗          ↗
 *   settings, ai, query-results, query-history  (independent)
 *
 * Two import-time effects come with that, both inherited from what Angular's root-provided
 * services did at injection time: the tab store reads `joinery:welcomeDismissed` and the settings
 * store reads `joinery-settings` from localStorage, and the chat panel store subscribes to
 * `chat.onStreamChunk` if the bridge is present. A module that only needs one store should import
 * that store's file directly.
 */

export {
  capabilitiesStore,
  createCapabilitiesStore,
  selectCapabilitiesFor,
  selectVariantFor,
  useCapabilitiesStore,
  type CapabilitiesState,
  type CapabilitiesStore,
  type ConnectionCapabilitiesEntry,
} from './capabilities';

export {
  diagnostics,
  notify,
  setDiagnosticsSink,
  setNotifier,
  type DiagnosticsSink,
  type Notifier,
} from './diagnostics';

export {
  schemaFolderDefs,
  tableSubFolderDefs,
  type SchemaFolderDef,
  type TableSubFolderDef,
} from './explorer-folders';

export {
  createExplorerStore,
  explorerStore,
  selectHasNodes,
  selectNodeById,
  selectSelectedNode,
  useExplorerStore,
  type ExplorerStore,
  type ExplorerStoreState,
  type NodeType,
  type TreeNode,
} from './explorer';

export {
  createTabStore,
  generateQueryTitle,
  selectActiveTab,
  selectDirtyTabs,
  selectHasTabs,
  selectTabCount,
  selectTabsUsingDatabase,
  tabStore,
  useTabStore,
  type LayoutTabState,
  type Tab,
  type TabsSlice,
  type TabStore,
  type TabStoreState,
  type TabType,
} from './tab';

export {
  connectionStore,
  createConnectionStore,
  resolveMostRecentConnectionId,
  selectDatabasesFor,
  selectDefaultDatabaseFor,
  selectFocusedConnectionId,
  selectFocusedDatabaseName,
  selectHasAnyConnection,
  selectHasProfiles,
  selectHealthFor,
  selectIsConnected,
  selectProfileFor,
  selectSelectedDatabaseFor,
  useConnectionStore,
  useMostRecentConnectionId,
  type ConnectionStore,
  type ConnectionStoreState,
} from './connection';

export {
  createQueryHistoryStore,
  queryHistoryStore,
  selectFailedQueries,
  selectHistoryCount,
  selectRecentEntries,
  selectSuccessfulQueries,
  selectUniqueConnections,
  selectUniqueDatabases,
  useQueryHistoryStore,
  type QueryHistoryStore,
  type QueryHistoryStoreState,
} from './query-history';

export {
  createQueryResultsStore,
  queryResultsStore,
  selectCanCompare,
  selectHasSnapshots,
  selectIsSnapshotSelected,
  selectPinnedSnapshots,
  selectSelectedCount,
  selectSelectedSnapshots,
  selectTotalStorageSize,
  useQueryResultsStore,
  type QueryResultsStore,
  type QueryResultsStoreState,
} from './query-results';

export {
  aiStore,
  createAIStore,
  selectAIEnabled,
  selectAnalysisEnabled,
  selectAutoRenameEnabled,
  selectEnabledVendors,
  selectHasConfiguredVendors,
  selectQueryAssistEnabled,
  selectVendor,
  selectVendorSettings,
  useAIStore,
  type AIStore,
  type AIStoreState,
} from './ai';

export {
  chatPanelStore,
  createChatStore,
  createChatTabStore,
  selectActiveConversation,
  selectHasConversations,
  useChatPanelStore,
  type ChatStore,
  type ChatStoreDeps,
  type ChatStoreOptions,
  type ChatStoreState,
  type ChatUiAction,
} from './chat';

export {
  applyThemeAttribute,
  createSettingsStore,
  nextThemePreference,
  resolveTheme,
  selectEditorSettings,
  selectEffectiveTheme,
  selectGridSettings,
  selectQuerySettings,
  selectTheme,
  settingsStore,
  useNativeThemeSync,
  useSettingsStore,
  type ResolvedTheme,
  type SettingsStore,
  type SettingsStoreState,
} from './settings';
