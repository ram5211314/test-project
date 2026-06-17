// ============================================================
// main/model/validator.ts — 模型完整性校验（SHA256）
// ============================================================

import * as fs from 'fs';
import * as crypto from 'crypto';

export function validateModel(filePath: string, expectedSha256: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (!fs.existsSync(filePath)) {
        resolve(false);
        return;
      }
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk as crypto.BinaryLike));
      stream.on('end', () => {
        const actual = hash.digest('hex');
        resolve(actual === expectedSha256);
      });
      stream.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

export function getFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk as crypto.BinaryLike));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}