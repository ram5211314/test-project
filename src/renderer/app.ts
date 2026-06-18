// ============================================================
// renderer/app.ts — 前端入口
// 初始化 UI、状态流、推理与图像重构
// ============================================================

import { UploadUI } from './ui/upload';
import { ViewerUI } from './ui/viewer';
import { ToolbarUI } from './ui/toolbar';
import { ProgressUI } from './ui/progress';
import { ResultUI } from './ui/result';
import { SettingsUI } from './ui/settings';
import { EffectsUI } from './ui/effects';
import { LiquidGlassUI } from './ui/liquid-glass';
import { appStore } from './state/store';
import { appEvents } from './state/events';
import { Events } from './state/types';
import { appAPI, fileAPI, inferenceAPI } from './api/ipc';
import { runImageReconstruction } from './api/external';
import type { AppError } from '../shared/types';

let pendingReferenceImageUrl: string | null = null;
let referenceImageBlob: Blob | null = null;

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function syncAppPhaseClass(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const phase = appStore.getState().phase;
  app.dataset.phase = phase;
  app.classList.toggle('app-has-content', phase !== 'idle');
  app.classList.toggle('app-is-busy', phase === 'inferring' || phase === 'processing');
}

async function resolveReferenceBlob(): Promise<Blob> {
  if (referenceImageBlob) return referenceImageBlob;
  if (!pendingReferenceImageUrl) {
    throw new Error('没有找到原始上传图片，请返回后重新上传');
  }

  const response = await fetch(pendingReferenceImageUrl);
  if (!response.ok) {
    throw new Error('读取原始上传图片失败');
  }
  referenceImageBlob = await response.blob();
  return referenceImageBlob;
}

async function setViewerWindowMode(imagePath: string): Promise<void> {
  try {
    const metadata = await fileAPI.getImageMetadata(imagePath);
    await appAPI.setWindowMode({
      mode: 'viewer',
      layout: { imageWidth: metadata.width, imageHeight: metadata.height },
    });
  } catch {
    await appAPI.setWindowMode('viewer');
  }
}

function emitUnknownError(message: string, err: unknown): void {
  appEvents.emit(Events.APP_ERROR, {
    code: 'UNKNOWN_ERROR',
    message,
    detail: String(err),
  } satisfies AppError);
}

document.addEventListener('DOMContentLoaded', async () => {
  appStore.initialize();
  syncAppPhaseClass();
  appStore.subscribe(() => syncAppPhaseClass());
  void appAPI.setWindowMode('compact');

  const uploadUI = new UploadUI();
  const viewerUI = new ViewerUI();
  const toolbarUI = new ToolbarUI();
  const progressUI = new ProgressUI();
  const resultUI = new ResultUI();
  const settingsUI = new SettingsUI();
  const effectsUI = new EffectsUI();
  new LiquidGlassUI();

  inferenceAPI.onStatus((status) => {
    if (status.stage === 'failed' || status.stage === 'cancelled') {
      effectsUI.clear();
      uploadUI.setEnabled(true);
      toolbarUI.setIdle();
    }
  });

  appEvents.on(Events.REFERENCE_IMAGE_READY, (url: string) => {
    pendingReferenceImageUrl = url;
  });

  appEvents.on(Events.IMAGE_SELECTED, async (payload: string | { path: string; file?: File }) => {
    const imagePath = typeof payload === 'string' ? payload : payload.path;
    referenceImageBlob = typeof payload === 'string' ? null : payload.file ?? null;

    appStore.dispatch({ type: 'SET_INPUT_IMAGE', path: imagePath });
    appStore.dispatch({ type: 'CLEAR_ERROR' });

    resultUI.clear();
    uploadUI.setLoading(true);
    uploadUI.setEnabled(false);
    toolbarUI.setProcessing();
    await waitForNextPaint();
    await setViewerWindowMode(imagePath);

    appStore.dispatch({ type: 'SET_PHASE', phase: 'inferring' });
    uploadUI.hide();
    effectsUI.showPreviewUrl(pendingReferenceImageUrl);
    appEvents.emit(Events.INFERENCE_START, imagePath);

    try {
      const settings = settingsUI.getSettings();
      const result = await inferenceAPI.start({
        imagePath,
        qualityPreset: settings.qualityPreset,
        opacityThreshold: settings.opacityThreshold,
        maxGaussians: settings.maxGaussians,
        focalPxOverride: settings.focalPxOverride ?? undefined,
      });

      if ('code' in result) {
        appEvents.emit(Events.INFERENCE_ERROR, result as AppError);
        return;
      }

      appStore.dispatch({ type: 'SET_PLY', path: result.plyPath });
      await viewerUI.loadPly(result.plyUrl, settings);
      viewerUI.frameToImage(result.image);
      await viewerUI.setReferenceImage(pendingReferenceImageUrl ?? result.referenceImageUrl ?? imagePath);
      appStore.dispatch({ type: 'SET_PHASE', phase: 'ready' });
      toolbarUI.setEnabled(true);
      effectsUI.hideBusy();
      appEvents.emit(Events.INFERENCE_COMPLETE, result);
    } catch (err) {
      effectsUI.clear();
      uploadUI.show();
      uploadUI.setLoading(false);
      uploadUI.setEnabled(true);
      appEvents.emit(Events.INFERENCE_ERROR, {
        code: 'INFERENCE_FAILED',
        message: '推理失败',
        detail: String(err),
      } satisfies AppError);
    }
  });

  appEvents.on(Events.INFERENCE_ERROR, (err: AppError) => {
    effectsUI.clear();
    uploadUI.show();
    uploadUI.setLoading(false);
    uploadUI.setEnabled(true);
    toolbarUI.setIdle();
    resultUI.clear();
    appStore.dispatch({ type: 'SET_PHASE', phase: 'idle' });
    appStore.dispatch({ type: 'SET_ERROR', error: err });
    void appAPI.setWindowMode('compact');
    appEvents.emit(Events.APP_ERROR, err);
  });

  appEvents.on(Events.APP_ERROR, (err: AppError) => {
    appStore.dispatch({ type: 'SET_ERROR', error: err });
    console.error(`[${err.code}] ${err.message}: ${err.detail}`);
    progressUI.show(err.message);
    progressUI.update(0, err.detail);
    window.setTimeout(() => progressUI.hide(), 5200);
  });

  appEvents.on(Events.RECONSTRUCTION_START, async () => {
    const settings = settingsUI.getSettings();
    if (!settings.kieApiKey.trim()) {
      settingsUI.open();
      appEvents.emit(Events.APP_ERROR, {
        code: 'EXTERNAL_API_ERROR',
        message: '缺少 KIE API Key',
        detail: '请在设置中填写 KIE 密钥后再开始重构',
      } satisfies AppError);
      return;
    }

    let capturedBlob: Blob | null = null;
    try {
      toolbarUI.setProcessing();
      appStore.dispatch({ type: 'SET_PHASE', phase: 'processing' });
      resultUI.clear();
      effectsUI.showPreviewUrl(pendingReferenceImageUrl);

      capturedBlob = await viewerUI.capture();
      const originalBlob = await resolveReferenceBlob();
      const processedBlob = await runImageReconstruction({
        provider: settings.reconstructionProvider,
        model: settings.reconstructionModel,
        apiKey: settings.kieApiKey,
        gaussianBlob: capturedBlob,
        referenceBlob: originalBlob,
        resolution: settings.reconstructionResolution,
      });

      resultUI.showReconstruction(originalBlob, processedBlob);
      toolbarUI.setResultMode();
      effectsUI.hideBusy();
      appStore.dispatch({ type: 'SET_PHASE', phase: 'ready' });
      appEvents.emit(Events.EXTERNAL_API_RESULT, processedBlob);
    } catch (err) {
      effectsUI.hideBusy();
      toolbarUI.setEnabled(true);
      appStore.dispatch({ type: 'SET_PHASE', phase: 'ready' });
      appEvents.emit(Events.EXTERNAL_API_ERROR, {
        code: 'EXTERNAL_API_ERROR',
        message: '图像重构失败',
        detail: String(err),
      } satisfies AppError);
    }
  });

  appEvents.on(Events.RECONSTRUCTION_COMPARE_START, () => {
    resultUI.showOriginal();
  });

  appEvents.on(Events.RECONSTRUCTION_COMPARE_END, () => {
    resultUI.showProcessed();
  });

  appEvents.on(Events.RECONSTRUCTION_SAVE, () => {
    resultUI.saveProcessed();
  });

  appEvents.on(Events.EXTERNAL_API_ERROR, (err: AppError) => {
    appEvents.emit(Events.APP_ERROR, err);
  });

  appEvents.on('viewer:reset', () => {
    viewerUI.resetCamera();
  });

  appEvents.on('settings:open', () => {
    settingsUI.open();
  });

  appEvents.on(Events.RETURN_TO_UPLOAD, () => {
    appStore.dispatch({ type: 'RESET' });
    pendingReferenceImageUrl = null;
    referenceImageBlob = null;
    effectsUI.clear();
    resultUI.clear();
    uploadUI.show();
    uploadUI.setLoading(false);
    uploadUI.setEnabled(true);
    toolbarUI.setIdle();
    void appAPI.setWindowMode('compact');
  });

  appEvents.on(Events.MODEL_DOWNLOAD_PROGRESS, () => {});

  window.addEventListener('unhandledrejection', (event) => {
    emitUnknownError('未处理的异步错误', event.reason);
  });
});
