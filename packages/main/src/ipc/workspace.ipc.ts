/**
 * Workspace IPC Handlers
 * Handles file/folder operations for workspace support
 */

import { dialog, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { watch, FSWatcher } from 'fs';
import { IPC_CHANNELS } from '@joinery/shared';
import type { FileTreeNode, WorkspaceInfo, WorkspaceSettings } from '@joinery/shared';
import { AppStateStore } from '../services/config/app-state';
import { createLogger } from '../utils/logger';
import { safeHandle } from './safe-handle';

const log = createLogger('Workspace');

const WORKSPACE_SETTINGS_FILE = '.joinery.json';
const SQL_EXTENSIONS = ['.sql', '.tsql', '.prc', '.fnc', '.trg', '.vw'];

// Track active file watchers
const activeWatchers = new Map<string, FSWatcher>();

/**
 * Validates that a file path is within the current workspace boundary.
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 */
function validatePathWithinWorkspace(filePath: string, workspacePath: string | null): void {
  if (!workspacePath) {
    throw new Error('No workspace is currently open');
  }
  const resolved = path.resolve(filePath);
  const workspaceResolved = path.resolve(workspacePath);
  if (!resolved.startsWith(workspaceResolved + path.sep) && resolved !== workspaceResolved) {
    throw new Error('Access denied: path is outside the workspace boundary');
  }
}

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

export function registerWorkspaceHandlers(): void {
  const appState = AppStateStore.getInstance();

  // Open folder and get workspace info
  safeHandle(
    IPC_CHANNELS.WORKSPACE.OPEN_FOLDER,
    async (_event, folderPath?: string): Promise<WorkspaceInfo | null> => {
      let targetPath = folderPath;
      const mainWindow = getMainWindow();

      if (!targetPath) {
        if (!mainWindow) return null;
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openDirectory'],
          title: 'Open Folder',
        });

        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        targetPath = result.filePaths[0];
      }

      const files = await buildFileTree(targetPath);
      const settings = await loadWorkspaceSettings(targetPath);

      // Save to app state
      appState.setCurrentWorkspacePath(targetPath);

      // Set up file watcher
      if (mainWindow) {
        setupFileWatcher(targetPath, mainWindow);
      }

      return {
        path: targetPath,
        name: path.basename(targetPath),
        files,
        settings,
      };
    }
  );

  // Get files in a directory
  safeHandle(
    IPC_CHANNELS.WORKSPACE.GET_FILES,
    async (_event, dirPath: string): Promise<FileTreeNode[]> => {
      validatePathWithinWorkspace(dirPath, appState.getCurrentWorkspacePath());
      return buildFileTree(dirPath);
    }
  );

  // Read file contents
  safeHandle(
    IPC_CHANNELS.WORKSPACE.READ_FILE,
    async (_event, filePath: string): Promise<string> => {
      validatePathWithinWorkspace(filePath, appState.getCurrentWorkspacePath());
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    }
  );

  // Write file contents
  safeHandle(
    IPC_CHANNELS.WORKSPACE.WRITE_FILE,
    async (_event, filePath: string, content: string): Promise<void> => {
      validatePathWithinWorkspace(filePath, appState.getCurrentWorkspacePath());
      await fs.writeFile(filePath, content, 'utf-8');
    }
  );

  // Create new file
  safeHandle(
    IPC_CHANNELS.WORKSPACE.CREATE_FILE,
    async (_event, filePath: string, content?: string): Promise<void> => {
      validatePathWithinWorkspace(filePath, appState.getCurrentWorkspacePath());
      await fs.writeFile(filePath, content || '', 'utf-8');
    }
  );

  // Delete file
  safeHandle(
    IPC_CHANNELS.WORKSPACE.DELETE_FILE,
    async (_event, filePath: string): Promise<void> => {
      validatePathWithinWorkspace(filePath, appState.getCurrentWorkspacePath());
      await fs.unlink(filePath);
    }
  );

  // Rename file
  safeHandle(
    IPC_CHANNELS.WORKSPACE.RENAME_FILE,
    async (_event, oldPath: string, newPath: string): Promise<void> => {
      const workspace = appState.getCurrentWorkspacePath();
      validatePathWithinWorkspace(oldPath, workspace);
      validatePathWithinWorkspace(newPath, workspace);
      await fs.rename(oldPath, newPath);
    }
  );
}

async function buildFileTree(dirPath: string, depth = 0, maxDepth = 5): Promise<FileTreeNode[]> {
  if (depth >= maxDepth) return [];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes: FileTreeNode[] = [];

  for (const entry of entries) {
    // Skip hidden files/folders and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, depth + 1, maxDepth);
      // Only include directories that have SQL files (directly or in subdirs)
      if (hasSqlFiles(children) || depth < 2) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children,
        });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SQL_EXTENSIONS.includes(ext)) {
        nodes.push({
          name: entry.name,
          path: fullPath,
          type: 'file',
          extension: ext,
        });
      }
    }
  }

  // Sort: directories first, then files, alphabetically
  return nodes.sort((a, b) => {
    if (a.type === b.type) {
      return a.name.localeCompare(b.name);
    }
    return a.type === 'directory' ? -1 : 1;
  });
}

function hasSqlFiles(nodes: FileTreeNode[]): boolean {
  for (const node of nodes) {
    if (node.type === 'file') return true;
    if (node.children && hasSqlFiles(node.children)) return true;
  }
  return false;
}

async function loadWorkspaceSettings(
  workspacePath: string
): Promise<WorkspaceSettings | undefined> {
  const settingsPath = path.join(workspacePath, WORKSPACE_SETTINGS_FILE);
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    return JSON.parse(content) as WorkspaceSettings;
  } catch {
    return undefined;
  }
}

function setupFileWatcher(workspacePath: string, mainWindow: Electron.BrowserWindow): void {
  // Clean up existing watcher for this path
  if (activeWatchers.has(workspacePath)) {
    activeWatchers.get(workspacePath)?.close();
  }

  try {
    const watcher = watch(workspacePath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const ext = path.extname(filename).toLowerCase();
      if (SQL_EXTENSIONS.includes(ext)) {
        mainWindow.webContents.send(IPC_CHANNELS.WORKSPACE.FILE_CHANGED, {
          filePath: path.join(workspacePath, filename),
          type: eventType,
        });
      }
    });

    activeWatchers.set(workspacePath, watcher);
  } catch (error) {
    log.error('Failed to set up file watcher:', error);
  }
}

// Cleanup function for app shutdown
export function cleanupWorkspaceWatchers(): void {
  for (const watcher of activeWatchers.values()) {
    watcher.close();
  }
  activeWatchers.clear();
}
