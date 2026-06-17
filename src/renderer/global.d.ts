import type {
  AppError,
  InferenceResult,
  InferenceStartRequest,
  InferenceStatus,
  ModelStatus,
  OpenDialogReturnValue,
  RuntimeCapabilities,
} from '../shared/types';

declare global {
  interface Window {
    electronAPI: {
      startInference: (request: InferenceStartRequest) => Promise<InferenceResult | AppError>;
      cancelInference: (taskId?: string) => Promise<void>;
      onInferenceStatus: (callback: (status: InferenceStatus) => void) => () => void;
      getRuntimeCapabilities: () => Promise<RuntimeCapabilities>;
      getModelStatus: () => Promise<ModelStatus>;
      openImage: () => Promise<OpenDialogReturnValue>;
      registerLocalFile: (filePath: string) => Promise<string>;
      getPathForFile: (file: File) => string;
      getAppVersion: () => Promise<string>;
    };
  }
}

export {};
