// ============================================================
// main/utils/platform.ts — 平台检测与 GPU 后端选择
// ============================================================

import * as os from 'os';
import { execSync } from 'child_process';
import type { BackendProvider } from '../../shared/types';

export type BackendType = 'cpu' | 'cuda' | 'webgpu' | 'dml' | 'coreml';

export interface PlatformInfo {
  os: string;
  arch: string;
  availableBackend: BackendType;
  executionProviders: BackendProvider[];
}

function hasNvidiaGpu(): boolean {
  if (os.platform() !== 'win32' && os.platform() !== 'linux') {
    return false;
  }
  try {
    const output = execSync('nvidia-smi -L', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    return output.toLowerCase().includes('gpu');
  } catch {
    return false;
  }
}

function getWindowsProviders(): BackendProvider[] {
  return ['webgpu', 'cpu'];
}

function getLinuxProviders(): BackendProvider[] {
  if (hasNvidiaGpu()) {
    return ['cuda', 'cpu'];
  }
  return ['cpu'];
}

export function getPlatform(): PlatformInfo {
  const platform = os.platform();
  const arch = os.arch();

  // 支持通过环境变量强制指定后端，便于调试
  const forced = process.env.SHARP_VIEWER_FORCE_BACKEND;
  if (forced) {
    const normalized = forced === 'directml' ? 'dml' : forced;
    const provider = ['webgpu', 'dml', 'cuda', 'coreml', 'cpu'].includes(normalized)
      ? (normalized as BackendType)
      : 'cpu';
    const providers: BackendProvider[] = provider === 'cpu' ? ['cpu'] : [provider, 'cpu'];
    return {
      os: platform,
      arch,
      availableBackend: provider,
      executionProviders: providers,
    };
  }

  let executionProviders: BackendProvider[];
  let availableBackend: BackendType;

  if (platform === 'win32') {
    executionProviders = getWindowsProviders();
  } else if (platform === 'linux') {
    executionProviders = getLinuxProviders();
  } else if (platform === 'darwin') {
    executionProviders = ['coreml', 'webgpu', 'cpu'];
  } else {
    executionProviders = ['cpu'];
  }

  // 第一个推荐的 provider 作为显示用的后端名称
  const firstProvider = executionProviders[0];
  availableBackend = firstProvider as BackendType;

  return { os: platform, arch, availableBackend, executionProviders };
}

export function getAvailableBackend(): BackendType {
  return getPlatform().availableBackend;
}

export function getExecutionProviders(): string[] {
  return getPlatform().executionProviders;
}
