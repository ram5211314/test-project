// ============================================================
// main/inference/gaussian.ts — 高斯参数与 PLY 生成
// 对后处理后的参数执行 SVD 分解，生成标准 .ply 格式文件
// 兼容 GaussianSplats3D 的标准格式
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import type { RawGaussianParams } from './types';
import { getOutputDir } from '../utils/paths';
import { logger } from '../utils/logger';

/**
 * 四元数转旋转矩阵
 */
function quaternionToRotationMatrix(q: Float32Array, offset: number): number[] {
  const r = q[offset];
  const x = q[offset + 1];
  const y = q[offset + 2];
  const z = q[offset + 3];

  const r2 = r * r;
  const x2 = x * x;
  const y2 = y * y;
  const z2 = z * z;

  return [
    1 - 2 * (y2 + z2), 2 * (x * y - r * z), 2 * (x * z + r * y),
    2 * (x * y + r * z), 1 - 2 * (x2 + z2), 2 * (y * z - r * x),
    2 * (x * z - r * y), 2 * (y * z + r * x), 1 - 2 * (x2 + y2),
  ];
}

/**
 * 构建缩放矩阵
 */
function buildScaleMatrix(s: Float32Array, offset: number): number[] {
  return [
    s[offset], 0, 0,
    0, s[offset + 1], 0,
    0, 0, s[offset + 2],
  ];
}

/**
 * 矩阵乘法: R @ S
 */
function multiplyRS(R: number[], S: number[]): number[] {
  return [
    R[0] * S[0], R[1] * S[1], R[2] * S[2],
    R[3] * S[0], R[4] * S[1], R[5] * S[2],
    R[6] * S[0], R[7] * S[1], R[8] * S[2],
  ];
}

/**
 * 计算协方差矩阵: M @ M^T
 */
function computeCovariance(M: number[]): number[] {
  return [
    M[0] * M[0] + M[1] * M[1] + M[2] * M[2],
    M[0] * M[3] + M[1] * M[4] + M[2] * M[5],
    M[0] * M[6] + M[1] * M[7] + M[2] * M[8],
    M[3] * M[0] + M[4] * M[1] + M[5] * M[2],
    M[3] * M[3] + M[4] * M[4] + M[5] * M[5],
    M[3] * M[6] + M[4] * M[7] + M[5] * M[8],
    M[6] * M[0] + M[7] * M[1] + M[8] * M[2],
    M[6] * M[3] + M[7] * M[4] + M[8] * M[5],
    M[6] * M[6] + M[7] * M[7] + M[8] * M[8],
  ];
}

/**
 * 激活函数：sigmoid
 */
function sigmoid(x: number): number {
  return 1.0 / (1.0 + Math.exp(-x));
}

/**
 * 生成 .ply 文件
 * 格式兼容 GaussianSplats3D 标准
 */
export function generatePly(params: RawGaussianParams): string {
  const { means, singularValues, quaternions, colors, opacities, count } = params;
  logger.info(`生成 .ply 文件: ${count} 个高斯粒子`);

  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${count}`,
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
    'property float opacity',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'end_header',
    '',
  ].join('\n');

  // 每个顶点: 3(pos) + 3(normals) + 3(f_dc) + 1(opacity) + 3(scale) + 4(rot) = 17 floats
  const floatsPerVertex = 17;
  const buffer = Buffer.alloc(count * floatsPerVertex * 4);
  let offset = 0;

  for (let i = 0; i < count; i++) {
    // 位置 (x, y, z)
    buffer.writeFloatLE(means[i * 3], offset); offset += 4;
    buffer.writeFloatLE(means[i * 3 + 1], offset); offset += 4;
    buffer.writeFloatLE(means[i * 3 + 2], offset); offset += 4;

    // 法线 (nx, ny, nz) — 使用零向量
    buffer.writeFloatLE(0, offset); offset += 4;
    buffer.writeFloatLE(0, offset); offset += 4;
    buffer.writeFloatLE(0, offset); offset += 4;

    // 颜色 (f_dc_0, f_dc_1, f_dc_2) — SH DC 分量
    buffer.writeFloatLE(colors[i * 3], offset); offset += 4;
    buffer.writeFloatLE(colors[i * 3 + 1], offset); offset += 4;
    buffer.writeFloatLE(colors[i * 3 + 2], offset); offset += 4;

    // 透明度 (经过 sigmoid)
    const alpha = sigmoid(opacities[i]);
    buffer.writeFloatLE(alpha, offset); offset += 4;

    // 缩放 (scale_0, scale_1, scale_2) — 使用奇异值
    const scale = buildScaleMatrix(singularValues, i * 3);
    buffer.writeFloatLE(scale[0], offset); offset += 4;
    buffer.writeFloatLE(scale[4], offset); offset += 4;
    buffer.writeFloatLE(scale[8], offset); offset += 4;

    // 旋转 (rot_0, rot_1, rot_2, rot_3) — 四元数
    buffer.writeFloatLE(quaternions[i * 4], offset); offset += 4;
    buffer.writeFloatLE(quaternions[i * 4 + 1], offset); offset += 4;
    buffer.writeFloatLE(quaternions[i * 4 + 2], offset); offset += 4;
    buffer.writeFloatLE(quaternions[i * 4 + 3], offset); offset += 4;
  }

  const outputDir = getOutputDir();
  const timestamp = Date.now();
  const plyPath = path.join(outputDir, `output_${timestamp}.ply`);

  const fd = fs.openSync(plyPath, 'w');
  fs.writeSync(fd, header);
  fs.writeSync(fd, buffer);
  fs.closeSync(fd);

  logger.info(`.ply 文件已生成: ${plyPath}`);
  return plyPath;
}