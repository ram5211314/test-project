import { clipboard, contextBridge, ipcRenderer, nativeImage, webUtils } from 'electron';
import {
  IPC_APP_GET_VERSION,
  IPC_APP_SET_WINDOW_MODE,
  IPC_FILE_OPEN_IMAGE,
  IPC_FILE_REGISTER_LOCAL,
  IPC_INFERENCE_CANCEL,
  IPC_INFERENCE_START,
  IPC_INFERENCE_STATUS,
  IPC_MODEL_GET_STATUS,
  IPC_RUNTIME_GET_CAPABILITIES,
} from '../shared/ipc-channels';
import type { InferenceStartRequest, InferenceStatus, WindowMode } from '../shared/types';

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
  copyImageToClipboard: (imageBytes: Uint8Array | ArrayBuffer) => {
    const bytes = imageBytes instanceof Uint8Array ? imageBytes : new Uint8Array(imageBytes);
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) {
      throw new Error('无法从截图数据创建剪贴板图片');
    }
    clipboard.writeImage(image);
  },

  getAppVersion: () => ipcRenderer.invoke(IPC_APP_GET_VERSION),
  setWindowMode: (mode: WindowMode) => ipcRenderer.invoke(IPC_APP_SET_WINDOW_MODE, mode),
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronAPI = typeof api;
