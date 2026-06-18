// ============================================================
// main/utils/paths.ts — 路径管理
// ============================================================

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { MODEL_CACHE_DIR, ONNX_DATA_FILENAME, ONNX_MODEL_FILENAME, OUTPUT_DIR } from '../../shared/constants';

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getProjectRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

function hasBundledModel(dirPath: string): boolean {
  return (
    fs.existsSync(path.join(dirPath, ONNX_MODEL_FILENAME)) &&
    fs.existsSync(path.join(dirPath, ONNX_DATA_FILENAME))
  );
}

export function getModelCacheDir(): string {
  if (!app.isPackaged) {
    const dir = path.join(getProjectRoot(), MODEL_CACHE_DIR);
    ensureDir(dir);
    return dir;
  }

  const bundledDir = path.join(process.resourcesPath, MODEL_CACHE_DIR);
  if (hasBundledModel(bundledDir)) {
    return bundledDir;
  }

  const dir = path.join(app.getPath('userData'), MODEL_CACHE_DIR);
  ensureDir(dir);
  return dir;
}

export function getOutputDir(): string {
  const dir = app.isPackaged
    ? path.join(app.getPath('userData'), OUTPUT_DIR)
    : path.join(getProjectRoot(), OUTPUT_DIR);
  ensureDir(dir);
  return dir;
}

export function getTempDir(): string {
  const dir = path.join(require('os').tmpdir(), 'sharp-viewer');
  ensureDir(dir);
  return dir;
}
