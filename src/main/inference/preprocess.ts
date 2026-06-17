// ============================================================
// main/inference/preprocess.ts — 图片预处理
// 将输入图片转换为 ONNX 模型所需的张量格式
// 与 SHARP Python 端预处理逻辑完全一致
// ============================================================

import * as fs from 'fs';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { INPUT_IMAGE_SIZE } from '../../shared/constants';
import { logger } from '../utils/logger';

const SUPPORTED_FORMATS = ['jpg', 'jpeg', 'png', 'heic', 'heif'];

function getExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() || '';
}

function validateFormat(filePath: string): void {
  const ext = getExtension(filePath);
  if (!SUPPORTED_FORMATS.includes(ext)) {
    throw new Error(`不支持的图片格式 .${ext}，请使用 JPG/PNG/HEIC`);
  }
}

export async function preprocessImage(imagePath: string): Promise<ort.Tensor> {
  validateFormat(imagePath);

  try {
    const buffer = await fs.promises.readFile(imagePath);

    // 1. Resize 到 1536×1536
    const { data, info } = await sharp(buffer)
      .resize(INPUT_IMAGE_SIZE, INPUT_IMAGE_SIZE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;

    // 2. 转换为 Float32Array，归一化到 [0, 1]
    const floatData = new Float32Array(width * height * channels);
    for (let i = 0; i < data.length; i++) {
      floatData[i] = data[i] / 255.0;
    }

    // 3. 转换为 NCHW 格式 [1, 3, 1536, 1536]
    const nchw = new Float32Array(1 * channels * height * width);
    for (let c = 0; c < channels; c++) {
      for (let h = 0; h < height; h++) {
        for (let w = 0; w < width; w++) {
          const hwcIdx = (h * width + w) * channels + c;
          const nchwIdx = c * height * width + h * width + w;
          nchw[nchwIdx] = floatData[hwcIdx];
        }
      }
    }

    logger.info(`图片预处理完成: ${width}x${height}, ${channels} 通道`);

    return new ort.Tensor('float32', nchw, [1, channels, height, width]);
  } catch (err) {
    logger.error('图片预处理失败', err);
    throw new Error('预处理失败: ' + String(err));
  }
}