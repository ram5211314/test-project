// ============================================================
// renderer/api/external.ts — 外部 API 调用
// 将截图 Blob 发送至用户配置的外部 API，返回处理后的图片
// ============================================================

import type { ExternalApiConfig } from '../../shared/types';
import { DEFAULT_EXTERNAL_API_TIMEOUT } from '../../shared/constants';

export async function sendToExternalAPI(
  imageBlob: Blob,
  config: ExternalApiConfig
): Promise<Blob> {
  const formData = new FormData();
  formData.append(config.fieldName, imageBlob, 'screenshot.png');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_EXTERNAL_API_TIMEOUT);

  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers: config.headers,
      body: formData,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`外部 API 返回错误: ${response.status}`);
    }

    return response.blob();
  } finally {
    clearTimeout(timeout);
  }
}