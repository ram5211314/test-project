import { ipcMain, BrowserWindow } from 'electron';
import {
  IPC_INFERENCE_CANCEL,
  IPC_INFERENCE_START,
  IPC_INFERENCE_STATUS,
} from '../../shared/ipc-channels';
import type { InferenceStartRequest, InferenceStatus } from '../../shared/types';
import { BackendManager } from '../backend/manager';
import { logger } from '../utils/logger';

export function broadcastInferenceStatus(status: InferenceStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_INFERENCE_STATUS, status);
  }
}

export function registerInferenceHandlers(backend: BackendManager): void {
  ipcMain.handle(IPC_INFERENCE_START, async (_event, request: InferenceStartRequest) => {
    try {
      logger.info(`收到推理请求: ${request.imagePath}`);
      return await backend.start(request);
    } catch (error) {
      logger.error('推理启动失败', error);
      return {
        code: 'INFERENCE_FAILED',
        message: '推理启动失败',
        detail: String(error),
      };
    }
  });

  ipcMain.handle(IPC_INFERENCE_CANCEL, async (_event, taskId?: string) => {
    backend.cancel(taskId);
  });
}
