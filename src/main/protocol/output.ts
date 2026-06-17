import * as fs from 'fs';
import * as path from 'path';
import { protocol } from 'electron';
import { getOutputDir } from '../utils/paths';

const allowedOutputs = new Set<string>();
const allowedFiles = new Map<string, string>();

export function registerOutputFile(filePath: string): string {
  const resolved = path.resolve(filePath);
  allowedOutputs.add(resolved);
  return `sharp-viewer://output/${encodeURIComponent(path.basename(resolved))}`;
}

export function registerLocalFile(filePath: string): string {
  const resolved = path.resolve(filePath);
  const token = Buffer.from(resolved).toString('base64url');
  allowedFiles.set(token, resolved);
  return `sharp-viewer://file/${token}/${encodeURIComponent(path.basename(resolved))}`;
}

export function registerOutputProtocol(): void {
  protocol.handle('sharp-viewer', async (request) => {
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': '*',
      'cross-origin-resource-policy': 'cross-origin',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    let filePath: string;
    if (url.hostname === 'output') {
      const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      const outputDir = path.resolve(getOutputDir());
      filePath = path.resolve(outputDir, fileName);
      if (!filePath.startsWith(outputDir + path.sep) || !allowedOutputs.has(filePath)) {
        return new Response('Forbidden', { status: 403 });
      }
    } else if (url.hostname === 'file') {
      const token = url.pathname.replace(/^\/+/, '').split('/')[0];
      filePath = allowedFiles.get(token) ?? '';
      if (!filePath) {
        return new Response('Forbidden', { status: 403 });
      }
    } else {
      return new Response('Not found', { status: 404 });
    }

    try {
      const ext = path.extname(filePath).toLowerCase();
      const data = await fs.promises.readFile(filePath);
      const contentType =
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
        ext === '.png' ? 'image/png' :
        ext === '.webp' ? 'image/webp' :
        ext === '.heic' || ext === '.heif' ? 'image/heif' :
        'application/octet-stream';
      return new Response(data, {
        headers: {
          ...corsHeaders,
          'content-type': contentType,
          'content-length': String(data.byteLength),
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}
