import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IPC_APP_GET_VERSION,
  IPC_FILE_OPEN_IMAGE,
  IPC_FILE_REGISTER_LOCAL,
  IPC_INFERENCE_CANCEL,
  IPC_INFERENCE_START,
  IPC_INFERENCE_STATUS,
  IPC_MODEL_GET_STATUS,
  IPC_RUNTIME_GET_CAPABILITIES,
} from '../shared/ipc-channels';
import type { InferenceStartRequest, InferenceStatus } from '../shared/types';

const api = {
  startInference: (request: InferenceStartRequest) =>
    ipcRenderer.invoke(IPC_INFERENCE_START, request),
  cancelInference: (taskId?: string) =>
    ipcRenderer.invoke(IPC_INFERENCE_CANCEL, taskId),
  onInferenceStatus: (callback: (status: InferenceStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: InferenceStatus) => callback(status);
    ipcRenderer.on(IPC_INFERENCE_STATUS, listener);
    return () => ipcRenderer.removeListener(IPC_INFERENCE_STATUS, listener);
  },

  getRuntimeCapabilities: () =>
    ipcRenderer.invoke(IPC_RUNTIME_GET_CAPABILITIES),
  getModelStatus: () =>
    ipcRenderer.invoke(IPC_MODEL_GET_STATUS),

  openImage: () =>
    ipcRenderer.invoke(IPC_FILE_OPEN_IMAGE),
  registerLocalFile: (filePath: string) =>
    ipcRenderer.invoke(IPC_FILE_REGISTER_LOCAL, filePath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  getAppVersion: () => ipcRenderer.invoke(IPC_APP_GET_VERSION),
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
