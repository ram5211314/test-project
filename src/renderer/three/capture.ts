// ============================================================
// renderer/three/capture.ts — 截图功能
// 从 WebGLRenderer 的 Canvas 中捕获当前帧为 PNG Blob
// ============================================================

import type { WebGLRenderer } from 'three';

export function captureViewport(renderer: WebGLRenderer): Promise<Blob> {
  return new Promise((resolve, reject) => {
    renderer.domElement.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('截图失败：Canvas 为空'));
        }
      },
      'image/png',
      1.0
    );
  });
}