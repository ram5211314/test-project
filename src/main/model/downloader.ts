// ============================================================
// main/model/downloader.ts — 模型下载器
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { getModelCacheDir } from '../utils/paths';
import { validateModel } from './validator';
import {
  MODEL_URL,
  MODEL_DATA_URL,
  ONNX_MODEL_FILENAME,
  ONNX_DATA_FILENAME,
  EXPECTED_MODEL_SHA256,
} from '../../shared/constants';
import { logger } from '../utils/logger';

export type DownloadProgressCallback = (percent: number) => void;

export class ModelDownloader {
  private onnxCachePath: string;
  private onnxDataCachePath: string;

  constructor() {
    const cacheDir = getModelCacheDir();
    this.onnxCachePath = path.join(cacheDir, ONNX_MODEL_FILENAME);
    this.onnxDataCachePath = path.join(cacheDir, ONNX_DATA_FILENAME);
  }

  getOnnxCachePath(): string {
    return this.onnxCachePath;
  }

  getOnnxDataCachePath(): string {
    return this.onnxDataCachePath;
  }

  /**
   * 确保 ONNX 模型（.onnx + .onnx.data）存在并可被推理引擎加载。
   * 两个文件必须放在同一目录下，ONNX Runtime 会自动加载 .data 外部数据。
   */
  async ensureModel(onProgress?: DownloadProgressCallback): Promise<string> {
    const onnxExists = fs.existsSync(this.onnxCachePath);
    const dataExists = fs.existsSync(this.onnxDataCachePath);

    if (onnxExists && dataExists) {
      if (EXPECTED_MODEL_SHA256) {
        const isValid = await validateModel(this.onnxCachePath, EXPECTED_MODEL_SHA256);
        if (isValid) {
          logger.info('模型缓存有效，跳过下载');
          return this.onnxCachePath;
        }
        logger.warn('模型缓存校验失败，重新下载');
        fs.unlinkSync(this.onnxCachePath);
        fs.unlinkSync(this.onnxDataCachePath);
      } else {
        logger.info('模型缓存存在（跳过校验），使用缓存');
        return this.onnxCachePath;
      }
    }

    // 下载 .onnx（模型图，较小）
    if (!fs.existsSync(this.onnxCachePath)) {
      await this.downloadFile(MODEL_URL, this.onnxCachePath, 'ONNX 模型', onProgress);
    }

    // 下载 .onnx.data（外部权重，较大）
    if (!fs.existsSync(this.onnxDataCachePath)) {
      await this.downloadFile(MODEL_DATA_URL, this.onnxDataCachePath, 'ONNX 权重数据', onProgress);
    }

    return this.onnxCachePath;
  }

  private async downloadFile(
    url: string,
    destPath: string,
    label: string,
    onProgress?: DownloadProgressCallback,
  ): Promise<void> {
    logger.info(`开始下载${label}: ${url}`);

    // 清理可能存在的旧文件
    if (fs.existsSync(destPath)) {
      fs.unlinkSync(destPath);
    }

    const totalSize = await this.getFileSize(url);

    return new Promise<void>((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const request = transport.get(url, (response) => {
        // 处理重定向
        if (response.statusCode === 301 || response.statusCode === 302) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error(`${label} 下载重定向失败`));
            return;
          }
          logger.info(`${label} 下载重定向: ${redirectUrl}`);
          this.downloadFile(redirectUrl, destPath, label, onProgress).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`${label} 下载失败，HTTP ${response.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(destPath);
        let downloaded = 0;
        const fileSize = totalSize || parseInt(response.headers['content-length'] || '0', 10);

        response.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (fileSize > 0 && onProgress) {
            onProgress(Math.round((downloaded / fileSize) * 100));
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          logger.info(`${label} 下载完成: ${destPath}`);
          resolve();
        });

        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          logger.error(`${label} 写入失败`, err);
          reject(err);
        });
      });

      request.on('error', (err) => {
        fs.unlink(destPath, () => {});
        logger.error(`${label} 下载请求失败`, err);
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        fs.unlink(destPath, () => {});
        reject(new Error(`${label} 下载超时`));
      });
    });
  }

  private async getFileSize(url: string): Promise<number> {
    return new Promise((resolve) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const request = transport.request(url, { method: 'HEAD' }, (response) => {
        const len = parseInt(response.headers['content-length'] || '0', 10);
        resolve(len);
      });

      request.on('error', () => resolve(0));
      request.on('timeout', () => {
        request.destroy();
        resolve(0);
      });
      request.end();
    });
  }
}
