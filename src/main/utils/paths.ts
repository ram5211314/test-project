// ============================================================
// main/utils/paths.ts — 路径管理
// ============================================================

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { MODEL_CACHE_DIR, OUTPUT_DIR } from '../../shared/constants';

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getProjectRoot(): string {
  return path.resolve(__dirname, '..', '..');
}

export function getModelCacheDir(): string {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, MODEL_CACHE_DIR)
    : path.join(getProjectRoot(), MODEL_CACHE_DIR);
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
