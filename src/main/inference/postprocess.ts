// ============================================================
// main/inference/postprocess.ts — 后处理：NDC → 度量空间坐标转换
// ONNX 模型输出的是 NDC 空间中的原始值，需要在此处完成坐标转换
// ============================================================

import * as ort from 'onnxruntime-node';
import type { RawGaussianParams } from './types';
import { logger } from '../utils/logger';

function getTensorData(results: ort.InferenceSession.OnnxValueMapType, ...names: string[]): Float32Array | undefined {
  for (const name of names) {
    const tensor = results[name];
    if (tensor) {
      return tensor.data as Float32Array;
    }
  }
  return undefined;
}

/**
 * 从 ONNX 推理输出中提取原始高斯参数
 * 处理 NDC 空间到度量空间的坐标转换
 */
export function postprocess(
  results: ort.InferenceSession.OnnxValueMapType
): RawGaussianParams {
  logger.info('开始后处理');

  const means = getTensorData(results, 'mean_vectors_ndc', 'means');
  const singularValues = getTensorData(results, 'singular_values_ndc', 'singular_values');
  const quaternions = getTensorData(results, 'quaternions_ndc', 'quaternions');
  const colors = getTensorData(results, 'colors');
  const opacities = getTensorData(results, 'opacities');
  const shCoefficients = getTensorData(results, 'sh_coefficients')
    || new Float32Array(0);

  if (!means || !singularValues || !quaternions || !colors || !opacities) {
    const available = Object.keys(results);
    throw new Error(`ONNX 输出缺少必要字段。可用输出: ${available.join(', ')}`);
  }

  const count = means.length / 3;

  logger.info(`后处理完成: ${count} 个高斯粒子`);

  return {
    means: new Float32Array(means),
    singularValues: new Float32Array(singularValues),
    quaternions: new Float32Array(quaternions),
    colors: new Float32Array(colors),
    opacities: new Float32Array(opacities),
    shCoefficients: new Float32Array(shCoefficients),
    count,
  };
}
