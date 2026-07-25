/**
 * Window Management
 */

import { BrowserWindow, screen, nativeTheme } from 'electron';
import * as path from 'path';
import Store from 'electron-store';
import { createTrailingDebounce } from './utils/trailing-debounce';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

const windowStateStore = new Store<{ windowState: WindowState }>({
  name: 'window-state',
  defaults: {
    windowState: {
      width: 1400,
      height: 900,
      isMaximized: false,
    },
  },
});

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const state = windowStateStore.get('windowState');

  // Validate window position is on a visible display
  const displays = screen.getAllDisplays();
  let validPosition = false;

  if (state.x !== undefined && state.y !== undefined) {
    for (const display of displays) {
      const { x, y, width, height } = display.bounds;
      if (state.x >= x && state.x < x + width && state.y >= y && state.y < y + height) {
        validPosition = true;
        break;
      }
    }
  }

  mainWindow = new BrowserWindow({
    x: validPosition ? state.x : undefined,
    y: validPosition ? state.y : undefined,
    width: state.width,
    height: state.height,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, '../../preload/dist/index.js'),
    },
  });

  // Restore maximized state
  if (state.isMaximized) {
    mainWindow.maximize();
  }

  // Save window state on changes
  const saveState = () => {
    if (!mainWindow) return;

    const bounds = mainWindow.getBounds();
    windowStateStore.set('windowState', {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: mainWindow.isMaximized(),
    });
  };

  // electron-store writes synchronously on the main thread; a raw per-event
  // save turns every drag/resize frame into a blocking disk write. Collapse
  // bursts to a single trailing write, and take the final bounds on close.
  const debouncedSave = createTrailingDebounce(saveState, 500);
  mainWindow.on('resize', () => debouncedSave.call());
  mainWindow.on('move', () => debouncedSave.call());
  mainWindow.on('close', () => {
    debouncedSave.cancel();
    saveState();
  });

  // Show when ready — unless we're under Playwright test, in which case
  // the launcher (tests/helpers/electron-app.ts) sets FORGE_TEST=1 and we
  // keep the window hidden. The renderer still paints into Chromium's
  // off-screen surface, so Playwright can interact with it and capture
  // screenshots via the devtools protocol; the user just doesn't see a
  // window flashing in/out on every test.
  mainWindow.once('ready-to-show', () => {
    if (process.env.FORGE_TEST !== '1') {
      mainWindow?.show();
    }
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:4200');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/dist/browser/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
