import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { app, utilityProcess } from 'electron';
import type {
  AppError,
  BackendProvider,
  BackendRequest,
  BackendRunConfig,
  BackendResponse,
  InferenceResult,
  InferenceStartRequest,
  InferenceStatus,
  RuntimeCapabilities,
} from '../../shared/types';
import { getModelCacheDir, getOutputDir } from '../utils/paths';
import { ONNX_MODEL_FILENAME } from '../../shared/constants';
import { registerLocalFile, registerOutputFile } from '../protocol/output';
import { logger } from '../utils/logger';

interface PendingTask {
  inputImagePath: string;
  resolve: (result: InferenceResult) => void;
  reject: (error: AppError) => void;
}

function normalizeProvider(value: string): BackendProvider | null {
  const provider = value.toLowerCase();
  if (provider === 'directml') return 'dml';
  if (provider === 'webgpu' || provider === 'dml' || provider === 'cuda' || provider === 'coreml' || provider === 'cpu') {
    return provider;
  }
  return null;
}

function getPreferredProviders(): BackendProvider[] {
  const forced = process.env.SHARP_VIEWER_FORCE_BACKEND;
  if (forced) {
    const provider = normalizeProvider(forced);
    return provider && provider !== 'cpu' ? [provider, 'cpu'] : ['cpu'];
  }
  const platform = os.platform();
  if (platform === 'win32') return ['webgpu', 'cpu'];
  if (platform === 'linux') return ['cuda', 'webgpu', 'cpu'];
  if (platform === 'darwin') return ['coreml', 'webgpu', 'cpu'];
  return ['cpu'];
}

export class BackendManager {
  private child: Electron.UtilityProcess | null = null;
  private activeTaskId: string | null = null;
  private pendingTasks = new Map<string, PendingTask>();
  private pendingCapabilities = new Map<string, (capabilities: RuntimeCapabilities) => void>();

  constructor(private readonly onStatus: (status: InferenceStatus) => void) {}

  async start(request: InferenceStartRequest): Promise<InferenceResult | AppError> {
    if (this.activeTaskId) {
      return {
        code: 'INFERENCE_FAILED',
        message: '已有推理任务正在运行',
        detail: `Active task: ${this.activeTaskId}`,
      };
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.activeTaskId = taskId;
    this.ensureProcess();
    this.onStatus({ taskId, stage: 'queued', progress: 0, message: 'Queued' });

    return new Promise<InferenceResult | AppError>((resolve) => {
      this.pendingTasks.set(taskId, {
        inputImagePath: request.imagePath,
        resolve: (result) => resolve(result),
        reject: (error) => resolve(error),
      });
      this.child?.postMessage({
        type: 'run',
        taskId,
        payload: request,
        config: this.createRunConfig(),
      } satisfies BackendRequest);
    });
  }

  cancel(taskId?: string): void {
    const target = taskId ?? this.activeTaskId ?? undefined;
    this.child?.postMessage({ type: 'cancel', taskId: target } satisfies BackendRequest);
  }

  async getCapabilities(): Promise<RuntimeCapabilities> {
    this.ensureProcess();
    const requestId = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve) => {
      this.pendingCapabilities.set(requestId, resolve);
      this.child?.postMessage({
        type: 'capabilities',
        requestId,
        config: this.createRunConfig(),
      } satisfies BackendRequest);
    });
  }

  dispose(): void {
    this.child?.kill();
    this.child = null;
    this.activeTaskId = null;
  }

  private createRunConfig(): BackendRunConfig {
    return {
      modelPath: path.join(getModelCacheDir(), ONNX_MODEL_FILENAME),
      outputDir: getOutputDir(),
      preferredProviders: getPreferredProviders(),
    };
  }

  private ensureProcess(): void {
    if (this.child) return;
    const workerPath = this.resolveWorkerPath();
    logger.info(`启动推理后端: ${workerPath}`);
    this.child = utilityProcess.fork(workerPath, [], {
      serviceName: 'sharp-viewer-inference',
    });
    this.child.on('message', (message: BackendResponse) => this.handleMessage(message));
    this.child.on('exit', (code) => this.handleExit(code));
  }

  private resolveWorkerPath(): string {
    const candidates = [
      path.join(__dirname, '..', 'backend', 'worker.js'),
      path.join(app.getAppPath(), 'dist', 'backend', 'worker.js'),
      path.join(process.cwd(), 'dist', 'backend', 'worker.js'),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found) return found;
    logger.warn(`未找到推理后端入口，尝试默认路径: ${candidates[0]}`);
    return candidates[0];
  }

  private handleMessage(message: BackendResponse): void {
    if (message.type === 'status') {
      this.onStatus(message.status);
      return;
    }
    if (message.type === 'capabilities') {
      const resolve = this.pendingCapabilities.get(message.requestId);
      this.pendingCapabilities.delete(message.requestId);
      resolve?.(message.capabilities);
      return;
    }
    if (message.type === 'result') {
      const pending = this.pendingTasks.get(message.taskId);
      this.pendingTasks.delete(message.taskId);
      this.activeTaskId = null;
      const plyUrl = registerOutputFile(message.result.plyPath);
      const referenceImageUrl = pending ? registerLocalFile(pending.inputImagePath) : undefined;
      pending?.resolve({ ...message.result, plyUrl, referenceImageUrl });
      return;
    }
    if (message.type === 'error') {
      const pending = this.pendingTasks.get(message.taskId);
      this.pendingTasks.delete(message.taskId);
      this.activeTaskId = null;
      pending?.reject({
        code: 'INFERENCE_FAILED',
        message: '推理失败',
        detail: message.error,
      });
    }
  }

  private handleExit(code: number): void {
    logger.warn(`推理后端已退出: ${code}`);
    this.child = null;
    this.activeTaskId = null;
    for (const [taskId, pending] of this.pendingTasks) {
      pending.reject({
        code: 'INFERENCE_FAILED',
        message: '推理后端已退出',
        detail: `Task ${taskId}, exit code ${code}`,
      });
    }
    this.pendingTasks.clear();
    for (const [requestId, resolve] of this.pendingCapabilities) {
      resolve({
        platform: os.platform(),
        arch: os.arch(),
        preferredProviders: getPreferredProviders(),
        supportedProviders: [],
        nodeVersion: process.version,
        onnxRuntimeVersion: `backend-unavailable:${code}:${requestId}`,
      });
    }
    this.pendingCapabilities.clear();
  }
}
