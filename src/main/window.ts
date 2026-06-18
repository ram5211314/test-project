// ============================================================
// main/window.ts — 窗口管理
// ============================================================

import * as path from 'path';
import { BrowserWindow, screen } from 'electron';
import type { WindowMode } from '../shared/types';

const WINDOW_BOUNDS: Record<WindowMode, Electron.Rectangle> = {
  compact: {
    width: 460,
    height: 360,
    x: 0,
    y: 0,
  },
  viewer: {
    width: 1320,
    height: 860,
    x: 0,
    y: 0,
  },
};

let mainWindow: BrowserWindow | null = null;

function centerBounds(bounds: Electron.Rectangle): Electron.Rectangle {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  return {
    ...bounds,
    x: Math.round(area.x + (area.width - bounds.width) / 2),
    y: Math.round(area.y + (area.height - bounds.height) / 2),
  };
}

export function setMainWindowMode(mode: WindowMode): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const target = centerBounds(WINDOW_BOUNDS[mode]);
  if (mode === 'compact') {
    mainWindow.setResizable(false);
    mainWindow.setMinimumSize(target.width, target.height);
  } else {
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(960, 640);
  }
  mainWindow.setBounds(target, true);
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    ...centerBounds(WINDOW_BOUNDS.compact),
    minWidth: 460,
    minHeight: 360,
    title: '照片重构',
    frame: true,
    titleBarStyle: 'default',
    backgroundColor: '#ffffff',
    hasShadow: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;
  setMainWindowMode('compact');

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  win.once('ready-to-show', () => {
    win.show();
  });
  return win;
}
