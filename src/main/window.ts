// ============================================================
// main/window.ts — 窗口管理
// ============================================================

import * as path from 'path';
import { BrowserWindow } from 'electron';

export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: '照片重构',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  return win;
}
