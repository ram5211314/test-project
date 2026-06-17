import { app, protocol } from 'electron';
import { createMainWindow } from './window';
import { registerAllHandlers } from './ipc';
import { BackendManager } from './backend/manager';
import { broadcastInferenceStatus } from './ipc/inference';
import { registerOutputProtocol } from './protocol/output';
import { logger } from './utils/logger';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'sharp-viewer',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let backendManager: BackendManager | null = null;

app.whenReady().then(async () => {
  try {
    registerOutputProtocol();
    backendManager = new BackendManager(broadcastInferenceStatus);
    registerAllHandlers(backendManager);
    await createMainWindow();
    logger.info('应用启动完成');
  } catch (error) {
    logger.error('应用启动失败', error);
  }
});

app.on('window-all-closed', () => {
  backendManager?.dispose();
  app.quit();
});

app.on('before-quit', () => {
  backendManager?.dispose();
});

app.on('activate', async () => {
  if (app.isReady()) {
    const { BrowserWindow } = await import('electron');
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  }
});
