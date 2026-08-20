/**
 * Register all IPC handlers
 */

import { registerConnectionHandlers } from './connection.ipc';
import { registerDockerHandlers } from './docker.ipc';
import { registerDatabaseHandlers } from './database.ipc';
import { registerExplorerHandlers } from './explorer.ipc';
import { registerQueryHandlers } from './query.ipc';
import { registerQueryResultsHandlers } from './query-results.ipc';
import { registerBackupHandlers } from './backup.ipc';
import { registerServerFsHandlers } from './server-fs.ipc';
import { registerAppHandlers } from './app.ipc';
import { registerAIHandlers } from './ai.ipc';
import { registerThemeHandlers } from './theme.ipc';
import { registerWorkspaceHandlers } from './workspace.ipc';
import { registerSettingsHandlers } from './settings.ipc';
import { registerChatHandlers } from './chat.ipc';
import { registerLogHandlers } from './log.ipc';
import { registerCredentialHandlers } from './credentials.ipc';

export function registerAllHandlers(): void {
  registerLogHandlers();
  // Before the vault preload in `index.ts` kicks off, so a startup keychain refusal is
  // already being listened for when it happens (J-118).
  registerCredentialHandlers();
  registerConnectionHandlers();
  registerDockerHandlers();
  registerDatabaseHandlers();
  registerExplorerHandlers();
  registerQueryHandlers();
  registerQueryResultsHandlers();
  registerBackupHandlers();
  registerServerFsHandlers();
  registerAppHandlers();
  registerAIHandlers();
  registerThemeHandlers();
  registerWorkspaceHandlers();
  registerSettingsHandlers();
  registerChatHandlers();
}
