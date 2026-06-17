// ============================================================
// main/inference/types.ts — 推理内部类型
// ============================================================

export interface RawGaussianParams {
  means: Float32Array;
  singularValues: Float32Array;
  quaternions: Float32Array;
  colors: Float32Array;
  opacities: Float32Array;
  shCoefficients: Float32Array;
  count: number;
}