// ============================================================
// renderer/app.ts — 前端入口
// 初始化所有 UI 模块、事件总线、状态存储
// ============================================================

import { UploadUI } from './ui/upload';
import { ViewerUI } from './ui/viewer';
import { ToolbarUI } from './ui/toolbar';
import { ProgressUI } from './ui/progress';
import { ResultUI } from './ui/result';
import { StatusUI } from './ui/status';
import { SettingsUI } from './ui/settings';
import { appStore } from './state/store';
import { appEvents } from './state/events';
import { Events } from './state/types';
import { inferenceAPI, modelAPI, runtimeAPI } from './api/ipc';
import { sendToExternalAPI } from './api/external';
import type { AppError } from '../shared/types';
import type { ExternalApiConfig } from '../shared/types';

// 默认外部 API 配置
let externalApiConfig: ExternalApiConfig = {
  url: '',
  method: 'POST',
  headers: {},
  fieldName: 'image',
};
let pendingReferenceImageUrl: string | null = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化状态管理
  appStore.initialize();

  // 初始化 UI 组件
  const uploadUI = new UploadUI();
  const viewerUI = new ViewerUI();
  const toolbarUI = new ToolbarUI();
  const progressUI = new ProgressUI();
  const resultUI = new ResultUI();
  const statusUI = new StatusUI();
  const settingsUI = new SettingsUI();

  const refreshRuntimeStatus = async (): Promise<void> => {
    try {
      const [capabilities, modelStatus] = await Promise.all([
        runtimeAPI.getCapabilities(),
        modelAPI.getStatus(),
      ]);
      statusUI.setBackend(capabilities.preferredProviders.join(' > ').toUpperCase());
      statusUI.setModelStatus(modelStatus.ready ? '就绪' : '缺少模型文件');
    } catch (error) {
      statusUI.setModelStatus('后端检查失败');
      appEvents.emit(Events.APP_ERROR, {
        code: 'UNKNOWN_ERROR',
        message: '推理后端检查失败',
        detail: String(error),
      });
    }
  };

  inferenceAPI.onStatus((status) => {
    if (status.backend) statusUI.setBackend(status.backend.toUpperCase());
    if (status.stage === 'failed' || status.stage === 'cancelled') {
      progressUI.hide();
      uploadUI.setEnabled(true);
      return;
    }
    if (status.stage !== 'ready') {
      progressUI.show(status.message ?? '正在推理中...');
      progressUI.update(Math.round(status.progress ?? 0), status.message);
    }
  });

  // ---- 事件绑定 ----

  // 图片选择 → 开始推理
  appEvents.on(Events.REFERENCE_IMAGE_READY, (url: string) => {
    pendingReferenceImageUrl = url;
  });

  appEvents.on(Events.IMAGE_SELECTED, async (imagePath: string) => {
    appStore.dispatch({ type: 'SET_INPUT_IMAGE', path: imagePath });
    appStore.dispatch({ type: 'SET_PHASE', phase: 'inferring' });

    uploadUI.setEnabled(false);
    progressUI.show('正在推理中...');
    appEvents.emit(Events.INFERENCE_START, imagePath);

    try {
      const result = await inferenceAPI.start({
        imagePath,
        qualityPreset: settingsUI.getSettings().qualityPreset,
        opacityThreshold: settingsUI.getSettings().opacityThreshold,
        maxGaussians: settingsUI.getSettings().maxGaussians,
        focalPxOverride: settingsUI.getSettings().focalPxOverride ?? undefined,
      });

      if ('code' in result) {
        // 错误响应
        const err = result as AppError;
        appEvents.emit(Events.INFERENCE_ERROR, err);
        return;
      }

      // 成功
      appStore.dispatch({ type: 'SET_PLY', path: result.plyPath });

      uploadUI.hide();
      progressUI.show('正在加载高斯模型...');
      progressUI.update(96, '正在加载高斯模型...');
      await viewerUI.loadPly(result.plyUrl, settingsUI.getSettings());
      viewerUI.frameToImage(result.image);
      await viewerUI.setReferenceImage(pendingReferenceImageUrl ?? result.referenceImageUrl ?? imagePath);
      appStore.dispatch({ type: 'SET_PHASE', phase: 'ready' });
      toolbarUI.setEnabled(true);
      progressUI.hide();
      statusUI.setInferenceTime(result.durationMs);
      statusUI.setBackend(result.backend.toUpperCase());

      appEvents.emit(Events.INFERENCE_COMPLETE, result);
    } catch (err) {
      progressUI.hide();
      uploadUI.setEnabled(true);
      appEvents.emit(Events.INFERENCE_ERROR, {
        code: 'INFERENCE_FAILED',
        message: '推理失败',
        detail: String(err),
      });
    }
  });

  // 推理开始
  appEvents.on(Events.INFERENCE_START, () => {
    progressUI.show('正在推理中...');
  });

  // 推理完成
  appEvents.on(Events.INFERENCE_COMPLETE, (result) => {
    progressUI.hide();
    toolbarUI.setEnabled(true);
    statusUI.setInferenceTime(result.durationMs);
  });

  // 推理错误
  appEvents.on(Events.INFERENCE_ERROR, (err: AppError) => {
    progressUI.hide();
    uploadUI.setEnabled(true);
    appStore.dispatch({ type: 'SET_ERROR', error: err });
    appEvents.emit(Events.APP_ERROR, err);
  });

  // 通用错误
  appEvents.on(Events.APP_ERROR, (err: AppError) => {
    appStore.dispatch({ type: 'SET_ERROR', error: err });
    console.error(`[${err.code}] ${err.message}: ${err.detail}`);
    progressUI.show(err.message);
    progressUI.update(0, err.detail);
    window.setTimeout(() => progressUI.hide(), 5000);
  });

  // 截图完成 → 发送至外部 API
  appEvents.on(Events.CAPTURE_COMPLETE, async (blob: Blob) => {
    if (!externalApiConfig.url) {
      // 没有配置外部 API，仅保存截图
      resultUI.showResult(blob);
      return;
    }

    appStore.dispatch({ type: 'SET_PHASE', phase: 'processing' });
    progressUI.show('正在发送至外部 API...');

    try {
      const processedBlob = await sendToExternalAPI(blob, externalApiConfig);
      resultUI.showComparison(blob, processedBlob);
      appEvents.emit(Events.EXTERNAL_API_RESULT, processedBlob);
    } catch (err) {
      appEvents.emit(Events.EXTERNAL_API_ERROR, {
        code: 'EXTERNAL_API_ERROR',
        message: '外部 API 请求失败',
        detail: String(err),
      });
    } finally {
      progressUI.hide();
      appStore.dispatch({ type: 'SET_PHASE', phase: 'ready' });
    }
  });

  // 外部 API 错误
  appEvents.on(Events.EXTERNAL_API_ERROR, (err: AppError) => {
    appEvents.emit(Events.APP_ERROR, err);
  });

  // 重置视角
  appEvents.on('viewer:reset', () => {
    viewerUI.resetCamera();
  });

  // 设置面板
  appEvents.on('settings:open', () => {
    settingsUI.open();
  });

  settingsUI.onApply((settings) => {
    externalApiConfig.url = settings.externalApiUrl;
    void viewerUI.updateSettings(settings).catch((err) => {
      appEvents.emit(Events.APP_ERROR, {
        code: 'UNKNOWN_ERROR',
        message: '设置应用失败',
        detail: String(err),
      });
    });
  });

  appEvents.on(Events.MODEL_DOWNLOAD_PROGRESS, () => {});

  void refreshRuntimeStatus();
});
