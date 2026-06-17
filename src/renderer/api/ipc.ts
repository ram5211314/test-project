import type {
  AppError,
  InferenceResult,
  InferenceStartRequest,
  InferenceStatus,
  ModelStatus,
  OpenDialogReturnValue,
  RuntimeCapabilities,
} from '../../shared/types';

export const inferenceAPI = {
  start: (request: InferenceStartRequest): Promise<InferenceResult | AppError> =>
    window.electronAPI.startInference(request),
  cancel: (taskId?: string): Promise<void> =>
    window.electronAPI.cancelInference(taskId),
  onStatus: (cb: (status: InferenceStatus) => void): (() => void) =>
    window.electronAPI.onInferenceStatus(cb),
};

export const runtimeAPI = {
  getCapabilities: (): Promise<RuntimeCapabilities> =>
    window.electronAPI.getRuntimeCapabilities(),
};

export const modelAPI = {
  getStatus: (): Promise<ModelStatus> =>
    window.electronAPI.getModelStatus(),
};

export const fileAPI = {
  openImage: (): Promise<OpenDialogReturnValue> =>
    window.electronAPI.openImage(),
  registerLocalFile: (filePath: string): Promise<string> =>
    window.electronAPI.registerLocalFile(filePath),
  getPathForFile: (file: File): string =>
    window.electronAPI.getPathForFile(file),
};

export const appAPI = {
  getVersion: (): Promise<string> =>
    window.electronAPI.getAppVersion(),
};
