// ============================================================
// main/inference/engine.ts — ONNX 推理引擎
// 封装 ONNX Runtime 推理会话，管理模型加载/销毁，执行推理
// ============================================================

import * as ort from 'onnxruntime-node';
import { preprocessImage } from './preprocess';
import { postprocess } from './postprocess';
import { generatePly } from './gaussian';
import { ModelDownloader } from '../model/downloader';
import { getExecutionProviders, getAvailableBackend } from '../utils/platform';
import { logger } from '../utils/logger';

interface LegacyInferenceResult {
  plyPath: string;
  duration: number;
  gaussianCount: number;
}

export class InferenceEngine {
  private session: ort.InferenceSession | null = null;
  private cancelled = false;
  private initialized = false;
  private cpuFallback = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const downloader = new ModelDownloader();
      const modelPath = await downloader.ensureModel();
      logger.info('加载 ONNX 模型: ' + modelPath);

      const executionProviders = getExecutionProviders();
      const sessionOptions: ort.InferenceSession.SessionOptions = {
        executionProviders,
      };

      // DirectML EP 要求必须禁用内存模式优化并使用顺序执行；
      // 否则会在 DmlFusedNode 阶段触发 887A0001/DXGI_ERROR_INVALID_CALL。
      // 参见 https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html
      const usesDirectML = executionProviders.some((p) => p === 'dml');
      if (usesDirectML) {
        sessionOptions.executionMode = 'sequential';
        sessionOptions.enableMemPattern = false;
        sessionOptions.enableCpuMemArena = false;
        sessionOptions.graphOptimizationLevel = 'disabled';
        // 显式指定 deviceId 0（主 GPU），避免 DirectML 在部分机器上选到虚拟/核显。
        sessionOptions.executionProviders = executionProviders.map((p) =>
          p === 'dml' ? { name: 'dml', deviceId: 0 } : p
        );
        logger.info('启用 DirectML 兼容的 session 配置');
      }

      logger.info(`尝试推理后端: ${executionProviders.join(' > ')}`);

      this.session = await ort.InferenceSession.create(modelPath, sessionOptions);
      this.initialized = true;
      logger.info('推理引擎初始化完成');
    } catch (err) {
      logger.error('推理引擎初始化失败', err);
      throw err;
    }
  }

  async run(imagePath: string): Promise<LegacyInferenceResult> {
    try {
      return await this.runInternal(imagePath);
    } catch (err) {
      const backend = getAvailableBackend();
      const errText = String(err).toLowerCase();
      const isGpuError =
        errText.includes('dmlfusednode') ||
        errText.includes('directml') ||
        errText.includes('cuda') ||
        errText.includes('executionprovider');

      if (!this.cpuFallback && backend !== 'cpu' && isGpuError) {
        logger.warn('GPU 推理失败，自动回退 CPU:', err);
        this.cpuFallback = true;
        process.env.SHARP_VIEWER_FORCE_BACKEND = 'cpu';
        await this.dispose();
        await this.initialize();
        return await this.runInternal(imagePath);
      }

      logger.error('推理失败', err);
      throw err;
    }
  }

  private async runInternal(imagePath: string): Promise<LegacyInferenceResult> {
    if (!this.session) {
      throw new Error('引擎未初始化，请先调用 initialize()');
    }

    this.cancelled = false;
    const startTime = Date.now();

    // 1. 预处理
    logger.info('开始预处理: ' + imagePath);
    const tensor = await preprocessImage(imagePath);
    if (this.cancelled) throw new Error('推理已取消');

    // 2. ONNX 推理
    logger.info('开始 ONNX 推理');
    const feeds: Record<string, ort.Tensor> = {
      image: tensor,
      disparity_factor: new ort.Tensor('float32', new Float32Array([1.0]), [1]),
    };
    const results = await this.session.run(feeds);
    if (this.cancelled) throw new Error('推理已取消');

    // 3. 后处理
    logger.info('开始后处理');
    const gaussianParams = postprocess(results);

    // 4. 生成 .ply
    const plyPath = generatePly(gaussianParams);

    const duration = Date.now() - startTime;
    logger.info(`推理完成: ${duration}ms, ${gaussianParams.count} 个高斯粒子`);

    return {
      plyPath,
      duration,
      gaussianCount: gaussianParams.count,
    };
  }

  cancel(): void {
    this.cancelled = true;
    logger.info('推理已取消');
  }

  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.initialized = false;
    logger.info('推理引擎已释放');
  }
}
