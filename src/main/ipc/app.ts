import * as fs from 'fs';
import * as path from 'path';
import { ipcMain, app } from 'electron';
import {
  IPC_APP_GET_VERSION,
  IPC_APP_QUIT,
  IPC_MODEL_GET_STATUS,
  IPC_RUNTIME_GET_CAPABILITIES,
} from '../../shared/ipc-channels';
import { ONNX_DATA_FILENAME, ONNX_MODEL_FILENAME } from '../../shared/constants';
import type { ModelStatus } from '../../shared/types';
import { BackendManager } from '../backend/manager';
import { getModelCacheDir } from '../utils/paths';

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function getModelStatus(): ModelStatus {
  const modelDir = getModelCacheDir();
  const modelPath = path.join(modelDir, ONNX_MODEL_FILENAME);
  const dataPath = path.join(modelDir, ONNX_DATA_FILENAME);
  const modelExists = fs.existsSync(modelPath);
  const dataExists = fs.existsSync(dataPath);
  return {
    modelPath,
    dataPath,
    modelExists,
    dataExists,
    ready: modelExists && dataExists,
    modelSize: fileSize(modelPath),
    dataSize: fileSize(dataPath),
  };
}

export function registerAppHandlers(backend: BackendManager): void {
  ipcMain.handle(IPC_RUNTIME_GET_CAPABILITIES, async () => backend.getCapabilities());
  ipcMain.handle(IPC_MODEL_GET_STATUS, async () => getModelStatus());
  ipcMain.handle(IPC_APP_GET_VERSION, async () => app.getVersion());
  ipcMain.handle(IPC_APP_QUIT, async () => app.quit());
}
