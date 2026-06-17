# SHARP Viewer — 软件技术规格说明书

> 单图 → 3D 高斯泼溅 → 实时交互 → 视角导出 → 外部 API 处理 → 结果回传

| 项目 | 内容 |
|------|------|
| 版本 | v2.0 |
| 日期 | 2026 年 6 月 |
| 技术栈 | Electron + onnxruntime-node + Three.js + GaussianSplats3D |

---

## 1. 项目概述

### 1.1 项目定义

**SHARP Viewer** 是一个桌面应用，允许用户上传单张图片，利用 Apple SHARP 模型（已导出为 ONNX 格式）生成 3D 高斯泼溅场景，在三维空间中自由旋转/缩放/平移视角，捕获当前视角的截图，发送至外部 API 处理，并将处理结果回传显示。

### 1.2 核心功能流程

```
用户上传图片 → 图片预处理 → ONNX 模型推理 → 后处理生成 .ply → Three.js 加载 .ply → 用户交互调整视角 → 捕获当前视角截图 → 发送至外部 API → 显示处理结果
```

### 1.3 技术栈总览

| 层级 | 技术 | 版本要求 |
|------|------|----------|
| 桌面壳 | Electron | ≥ 28.0 |
| 前端语言 | TypeScript | ≥ 5.0 |
| 3D 渲染 | Three.js + @mkkellogg/gaussian-splats-3d | Three.js ≥ 0.160 |
| ML 推理 | onnxruntime-node | ≥ 1.18 |
| 模型格式 | ONNX (opset 20) | 从 PyTorch 导出 |
| 构建工具 | electron-builder + esbuild | 最新稳定版 |
| 包管理 | npm | ≥ 9.0 |

### 1.4 设计原则

- **单一职责**：每个文件只做一件事，所有模块通过明确的接口通信
- **依赖倒置**：模块依赖抽象接口，不依赖具体实现
- **无循环依赖**：依赖方向严格单向：`shared/` → `main/` / `renderer/`，`main/` 与 `renderer/` 互不直接引用
- **接口隔离**：每个模块仅暴露调用方需要的最小接口
- **文件大小**：单个文件不超过 300 行，超过则拆分为多个文件

---

## 2. 系统架构

### 2.1 架构全景图

```
┌─────────────────────────────────────────────────────────────────┐
│                    渲染进程 (Renderer Process)                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  UI 组件层    │  │  状态管理     │  │  3D 渲染层            │  │
│  │  upload      │  │  store       │  │  scene               │  │
│  │  viewer      │  │  events      │  │  splat-loader        │  │
│  │  toolbar     │  │              │  │  controls            │  │
│  │  progress    │  │              │  │  capture             │  │
│  │  result      │  │              │  │                      │  │
│  │  status      │  │              │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                  │                               │
│                      ┌───────────┴───────────┐                  │
│                      │  API 通信层            │                  │
│                      │  ipc / external        │                  │
│                      └───────────┬───────────┘                  │
└──────────────────────────────────┼────────────────────────────────┘
                                   │ IPC invoke
┌──────────────────────────────────┼────────────────────────────────┐
│                      主进程 (Main Process)                        │
│                                  │                                │
│  ┌──────────────────┐  ┌────────┴───────┐  ┌─────────────────┐  │
│  │  IPC 处理器       │  │  推理引擎       │  │  模型管理        │  │
│  │  inference       │  │  engine        │  │  downloader     │  │
│  │  file            │  │  preprocess    │  │  validator      │  │
│  │  app             │  │  postprocess   │  │                 │  │
│  │                  │  │  gaussian       │  │                 │  │
│  └──────────────────┘  └────────────────┘  └─────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │  工具层: logger / paths / platform                           ││
│  └──────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 进程模型

应用包含 **2 个进程**，通过 Electron IPC 通信：

| 进程 | 职责 | 关键技术 |
|------|------|----------|
| **主进程** | 窗口管理、ONNX 推理、模型下载、文件系统操作、系统级事件处理 | Node.js、onnxruntime-node |
| **渲染进程** | UI 展示、Three.js 3D 渲染、用户交互、外部 API 调用 | TypeScript、Three.js、WebGL |

### 2.3 端到端数据流

```
渲染进程                          主进程                     ONNX Runtime / 文件系统
  │                                │                              │
  ├── IPC: inference:run ────────►│                              │
  │                                ├── 读取图片文件 ────────────►│
  │                                ├── 预处理 (resize/normalize)  │
  │                                ├── 推理 ────────────────────►│
  │                                │◄── NDC 空间高斯参数 ────────┤
  │                                ├── 坐标转换 + SVD 分解        │
  │                                ├── 写入 .ply 文件 ──────────►│
  │◄── 返回 { plyPath, status } ──┤                              │
  ├── Three.js 加载 .ply          │                              │
  ├── 实时渲染 + 交互              │                              │
  ├── 用户截图                     │                              │
  ├── fetch 发送至外部 API         │                              │
  ├── 显示处理结果                 │                              │
```

### 2.4 依赖方向约束

```
src/shared/  ──────►  src/main/
    │
    └──────────────►  src/renderer/
```

**强制规则：** `main/` 和 `renderer/` 目录下的代码 **绝不** 互相 import。所有跨进程通信必须通过 IPC channel 完成，channel 名称和参数类型定义在 `shared/` 中。

---

## 3. 目录结构

```
sharp-viewer/
├── package.json                    # 依赖与脚本
├── tsconfig.json                   # TypeScript 编译配置
├── tsconfig.main.json              # 主进程 TS 配置（继承 tsconfig.json）
├── tsconfig.renderer.json          # 渲染进程 TS 配置（继承 tsconfig.json）
├── electron-builder.yml            # 打包配置
│
├── src/
│   ├── shared/                     # ▓ 共享层（main 和 renderer 共同依赖）
│   │   ├── types.ts                #    所有共享类型 / 接口定义
│   │   ├── constants.ts            #    常量（路径、端口、参数默认值）
│   │   └── ipc-channels.ts         #    IPC channel 名称常量
│   │
│   ├── main/                       # ▓ 主进程
│   │   ├── index.ts                #    入口：窗口创建、生命周期管理
│   │   ├── window.ts               #    BrowserWindow 创建与配置
│   │   │
│   │   ├── ipc/                    #    IPC 处理器
│   │   │   ├── index.ts            #      注册所有 handler
│   │   │   ├── inference.ts        #      推理相关 IPC handler
│   │   │   ├── file.ts             #      文件操作 IPC handler
│   │   │   └── app.ts              #      应用控制 IPC handler
│   │   │
│   │   ├── inference/              #    推理引擎
│   │   │   ├── engine.ts           #      ONNX Runtime 封装：加载/销毁/运行
│   │   │   ├── preprocess.ts       #      图片预处理（resize/normalize/tensor）
│   │   │   ├── postprocess.ts      #      后处理（NDC→度量空间坐标转换）
│   │   │   ├── gaussian.ts         #      高斯参数：SVD 分解、.ply 生成
│   │   │   └── types.ts            #      推理内部类型
│   │   │
│   │   ├── model/                  #    模型管理
│   │   │   ├── downloader.ts       #      模型下载（含进度回调）
│   │   │   └── validator.ts        #      模型完整性校验（SHA256）
│   │   │
│   │   └── utils/                  #    主进程工具
│   │       ├── logger.ts           #      统一日志
│   │       ├── paths.ts            #      路径管理（模型缓存、输出目录）
│   │       └── platform.ts         #      平台检测（CUDA/DirectML/MPS 可用性）
│   │
│   ├── renderer/                   # ▓ 渲染进程（前端）
│   │   ├── index.html              #    HTML 入口
│   │   ├── app.ts                  #    JS 入口：初始化所有模块
│   │   │
│   │   ├── ui/                     #    UI 组件
│   │   │   ├── upload.ts           #      图片上传组件（拖拽/点击/粘贴）
│   │   │   ├── viewer.ts           #      3D 查看器容器（挂载 Three.js）
│   │   │   ├── toolbar.ts          #      工具栏（截图、重置视角、导出）
│   │   │   ├── progress.ts         #      进度指示器（推理/下载进度）
│   │   │   ├── result.ts           #      结果展示面板（API 返回图片）
│   │   │   └── status.ts           #      状态栏（模型状态、GPU 信息）
│   │   │
│   │   ├── three/                  #    3D 渲染引擎
│   │   │   ├── scene.ts            #      场景初始化（Renderer/Camera/Light）
│   │   │   ├── splat-loader.ts     #      .ply 加载与 GaussianSplats3D 集成
│   │   │   ├── controls.ts         #      相机控制（OrbitControls 封装）
│   │   │   ├── capture.ts          #      截图功能（preserveDrawingBuffer）
│   │   │   └── types.ts            #      3D 相关类型
│   │   │
│   │   ├── api/                    #    API 通信
│   │   │   ├── ipc.ts              #      IPC 调用封装（主进程通信）
│   │   │   ├── external.ts         #      外部 API 调用（截图处理）
│   │   │   └── types.ts            #      API 请求/响应类型
│   │   │
│   │   ├── state/                  #    状态管理
│   │   │   ├── store.ts            #      全局状态存储
│   │   │   ├── events.ts           #      事件总线（发布/订阅）
│   │   │   └── types.ts            #      状态类型定义
│   │   │
│   │   └── styles/                 #    样式
│   │       ├── base.css            #      全局样式
│   │       ├── components.css      #      组件样式
│   │       └── viewer.css          #      3D 查看器样式
│   │
│   └── preload/                    # ▓ Preload 脚本
│       └── index.ts                #    contextBridge 暴露 API 给渲染进程
│
├── assets/                         # 静态资源
│   └── icons/                      #   应用图标
│
├── scripts/                        # 构建与工具脚本
│   ├── export-onnx.py              #   PyTorch → ONNX 模型导出脚本
│   └── dev-setup.sh                #   开发环境初始化
│
└── docs/                           # 文档
    └── tech-spec.md                #   本规格说明书
```

---

## 4. 共享层规格 (src/shared/)

> **共享层规则：** shared/ 目录下的文件 **不得** 引用 main/ 或 renderer/ 中的任何文件。它只能被其他目录引用，不能反向依赖。

### 4.1 shared/types.ts

定义主进程和渲染进程共用的所有 TypeScript 类型。此文件是 **整个项目的类型基石**，所有模块的类型都从此处派生或引用。

#### AppState

| 字段 | 类型 | 说明 |
|------|------|------|
| `phase` | `'idle' \| 'uploading' \| 'inferring' \| 'ready' \| 'capturing' \| 'processing'` | 应用当前阶段 |
| `inputImagePath` | `string \| null` | 用户上传的图片路径 |
| `plyPath` | `string \| null` | 生成的 .ply 文件路径 |
| `error` | `AppError \| null` | 当前错误信息 |

#### AppError

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | `ErrorCode` | 错误码枚举 |
| `message` | `string` | 用户可读的错误描述 |
| `detail` | `string` | 技术细节（用于日志） |

#### ErrorCode

```typescript
type ErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'MODEL_DOWNLOAD_FAILED'
  | 'MODEL_VALIDATION_FAILED'
  | 'INFERENCE_FAILED'
  | 'PREPROCESS_FAILED'
  | 'POSTPROCESS_FAILED'
  | 'PLY_GENERATION_FAILED'
  | 'FILE_READ_ERROR'
  | 'FILE_WRITE_ERROR'
  | 'UNSUPPORTED_IMAGE_FORMAT'
  | 'EXTERNAL_API_ERROR'
  | 'UNKNOWN_ERROR';
```

#### InferenceResult

| 字段 | 类型 | 说明 |
|------|------|------|
| `plyPath` | `string` | 生成的 .ply 文件绝对路径 |
| `duration` | `number` | 推理耗时（毫秒） |
| `gaussianCount` | `number` | 高斯粒子数量 |

#### ModelInfo

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | `string` | 模型文件路径 |
| `size` | `number` | 文件大小（字节） |
| `sha256` | `string` | SHA256 校验值 |
| `isValid` | `boolean` | 是否通过完整性校验 |

#### ExternalApiConfig

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | `string` | 外部 API 地址 |
| `method` | `'POST' \| 'PUT'` | HTTP 方法 |
| `headers` | `Record<string, string>` | 自定义请求头 |
| `fieldName` | `string` | 图片字段名（默认 'image'） |

### 4.2 shared/ipc-channels.ts

定义所有 IPC channel 名称常量。渲染进程和主进程 **必须** 使用这些常量而非硬编码字符串。

```typescript
// ---- 推理 ----
export const IPC_INFERENCE_RUN = 'inference:run';
export const IPC_INFERENCE_PROGRESS = 'inference:progress'; // 主→渲染
export const IPC_INFERENCE_CANCEL = 'inference:cancel';

// ---- 模型管理 ----
export const IPC_MODEL_GET_INFO = 'model:get-info';
export const IPC_MODEL_DOWNLOAD = 'model:download';
export const IPC_MODEL_DOWNLOAD_PROGRESS = 'model:download-progress'; // 主→渲染
export const IPC_MODEL_VALIDATE = 'model:validate';

// ---- 文件操作 ----
export const IPC_FILE_OPEN_DIALOG = 'file:open-dialog';
export const IPC_FILE_READ = 'file:read';
export const IPC_FILE_WRITE = 'file:write';
export const IPC_FILE_GET_PATH = 'file:get-path';

// ---- 应用控制 ----
export const IPC_APP_GET_PLATFORM = 'app:get-platform';
export const IPC_APP_GET_VERSION = 'app:get-version';
export const IPC_APP_QUIT = 'app:quit';
```

### 4.3 shared/constants.ts

```typescript
// 模型
export const MODEL_URL = 'https://ml-site.cdn-apple.com/models/sharp/sharp_2572gikvuh.pt';
export const MODEL_FILENAME = 'sharp_2572gikvuh.pt';
export const ONNX_MODEL_FILENAME = 'sharp_predictor.onnx';
export const EXPECTED_MODEL_SHA256 = ''; // 导出时填入

// 推理
export const INPUT_IMAGE_SIZE = 1536;       // SHARP 输入分辨率
export const PATCH_SIZE = 384;              // 补丁尺寸
export const NUM_PATCHES = 25;              // 重叠补丁数量

// 路径
export const MODEL_CACHE_DIR = 'models';
export const OUTPUT_DIR = 'output';

// 3D 渲染
export const DEFAULT_CAMERA_POSITION = [-1, -4, 6];
export const DEFAULT_CAMERA_LOOK_AT = [0, 4, 0];
export const DEFAULT_CAMERA_UP = [0, -1, -0.6];

// 外部 API
export const DEFAULT_EXTERNAL_API_TIMEOUT = 30000; // 30s
```

---

## 5. 主进程规格 (src/main/)

### 5.1 main/index.ts — 入口

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/index.ts` |
| 单一职责 | 应用生命周期管理。创建窗口、注册 IPC handler、启动推理引擎、处理应用退出。 |
| 导出 | 无（入口文件） |
| 依赖 | `window.ts`, `ipc/index.ts`, `inference/engine.ts`, `utils/logger.ts` |

```typescript
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window';
import { registerAllHandlers } from './ipc';
import { InferenceEngine } from './inference/engine';
import { logger } from './utils/logger';

let inferenceEngine: InferenceEngine | null = null;

app.whenReady().then(async () => {
  // 1. 初始化推理引擎（预加载 ONNX 模型）
  inferenceEngine = new InferenceEngine();
  // 2. 注册所有 IPC handler
  registerAllHandlers(inferenceEngine);
  // 3. 创建窗口
  await createMainWindow();
});

app.on('window-all-closed', async () => {
  // 释放推理引擎资源
  await inferenceEngine?.dispose();
  app.quit();
});
```

### 5.2 main/window.ts — 窗口管理

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/window.ts` |
| 单一职责 | 创建 BrowserWindow 实例，配置窗口参数，加载渲染进程。 |
| 导出 | `createMainWindow() => Promise<BrowserWindow>` |

```typescript
export async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,   // 必须开启
      nodeIntegration: false,   // 必须关闭
      sandbox: false,           // onnxruntime-node 需要
    },
  });
  await win.loadFile(path.join(__dirname, '../renderer/index.html'));
  return win;
}
```

### 5.3 IPC 处理器 (main/ipc/)

#### 5.3.1 main/ipc/index.ts — 注册中心

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/ipc/index.ts` |
| 单一职责 | 集中注册所有 IPC handler。不包含任何业务逻辑，仅做路由分发。 |
| 导出 | `registerAllHandlers(engine: InferenceEngine) => void` |
| 依赖 | `inference.ts`, `file.ts`, `app.ts` |

```typescript
import { ipcMain } from 'electron';
import { InferenceEngine } from '../inference/engine';
import { registerInferenceHandlers } from './inference';
import { registerFileHandlers } from './file';
import { registerAppHandlers } from './app';

export function registerAllHandlers(engine: InferenceEngine): void {
  registerInferenceHandlers(engine);
  registerFileHandlers();
  registerAppHandlers();
}
```

#### 5.3.2 main/ipc/inference.ts — 推理 IPC Handler

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/ipc/inference.ts` |
| 单一职责 | 处理推理相关的 IPC 请求。接收图片路径，调用推理引擎，返回 .ply 路径。 |
| 导出 | `registerInferenceHandlers(engine: InferenceEngine) => void` |

> **实现要点：** 推理在后台线程中执行（通过 onnxruntime-node 的异步 API），防止阻塞主进程事件循环。推理过程中通过 `IPC_INFERENCE_PROGRESS` 向渲染进程推送进度。

```typescript
import { ipcMain } from 'electron';
import { InferenceEngine } from '../inference/engine';
import { IPC_INFERENCE_RUN, IPC_INFERENCE_CANCEL } from '../../shared/ipc-channels';
import type { InferenceResult, AppError } from '../../shared/types';

export function registerInferenceHandlers(engine: InferenceEngine): void {
  ipcMain.handle(IPC_INFERENCE_RUN,
    async (_event, imagePath: string): Promise<InferenceResult | AppError> => {
      try {
        return await engine.run(imagePath);
      } catch (err) {
        return { code: 'INFERENCE_FAILED', message: '推理失败', detail: String(err) };
      }
    }
  );

  ipcMain.handle(IPC_INFERENCE_CANCEL, async () => {
    engine.cancel();
  });
}
```

#### 5.3.3 main/ipc/file.ts — 文件操作 IPC Handler

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/ipc/file.ts` |
| 单一职责 | 处理文件对话框、文件读写等 IPC 请求。 |
| 导出 | `registerFileHandlers() => void` |

```typescript
import { ipcMain, dialog } from 'electron';
import { IPC_FILE_OPEN_DIALOG, IPC_FILE_GET_PATH } from '../../shared/ipc-channels';
import { getOutputDir, getModelCacheDir } from '../utils/paths';

export function registerFileHandlers(): void {
  ipcMain.handle(IPC_FILE_OPEN_DIALOG, async (_event, options) => {
    return dialog.showOpenDialog({
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'heif'] }],
      ...options,
    });
  });

  ipcMain.handle(IPC_FILE_GET_PATH, async (_event, type: 'output' | 'model-cache') => {
    return type === 'output' ? getOutputDir() : getModelCacheDir();
  });
}
```

#### 5.3.4 main/ipc/app.ts — 应用控制 IPC Handler

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/ipc/app.ts` |
| 单一职责 | 处理应用级别控制请求（版本查询、平台检测、退出）。 |
| 导出 | `registerAppHandlers() => void` |

### 5.4 推理引擎 (main/inference/)

#### 5.4.1 main/inference/engine.ts — ONNX 推理引擎

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/inference/engine.ts` |
| 单一职责 | 封装 ONNX Runtime 推理会话。管理模型加载/销毁，执行推理，对外暴露 `run(imagePath)` 方法。 |
| 导出 | `class InferenceEngine` |
| 依赖 | `preprocess.ts`, `postprocess.ts`, `gaussian.ts`, `model/downloader.ts`, `utils/logger.ts` |

```typescript
import * as ort from 'onnxruntime-node';
import { preprocessImage } from './preprocess';
import { postprocess } from './postprocess';
import { generatePly } from './gaussian';
import { ModelDownloader } from '../model/downloader';
import type { InferenceResult } from '../../shared/types';

export class InferenceEngine {
  private session: ort.InferenceSession | null = null;
  private cancelled = false;

  async initialize(): Promise<void> {
    // 确保模型已下载且完整
    const downloader = new ModelDownloader();
    const modelPath = await downloader.ensureModel();
    // 创建推理会话
    this.session = await ort.InferenceSession.create(modelPath);
  }

  async run(imagePath: string): Promise<InferenceResult> {
    if (!this.session) throw new Error('引擎未初始化');
    this.cancelled = false;
    const startTime = Date.now();

    // 1. 预处理
    const tensor = await preprocessImage(imagePath);
    if (this.cancelled) throw new Error('推理已取消');

    // 2. ONNX 推理
    const feeds = { 'input': tensor };
    const results = await this.session.run(feeds);
    if (this.cancelled) throw new Error('推理已取消');

    // 3. 后处理
    const gaussianParams = postprocess(results);
    // 4. 生成 .ply
    const plyPath = generatePly(gaussianParams);

    const duration = Date.now() - startTime;
    return { plyPath, duration, gaussianCount: gaussianParams.count };
  }

  cancel(): void { this.cancelled = true; }
  async dispose(): Promise<void> { await this.session?.release(); }
}
```

#### 5.4.2 main/inference/preprocess.ts — 图片预处理

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/inference/preprocess.ts` |
| 单一职责 | 将输入图片转换为 ONNX 模型所需的张量格式。与 Python 端预处理逻辑完全一致。 |
| 导出 | `preprocessImage(imagePath: string) => Promise<ort.Tensor>` |

> **关键约束：** 预处理逻辑必须与 SHARP 原始的 Python 预处理完全一致（归一化参数、resize 方式、通道顺序），否则 ONNX 输出会与 PyTorch 原版产生偏差。

```typescript
import sharp from 'sharp'; // Node.js 图片处理库
import * as ort from 'onnxruntime-node';
import { INPUT_IMAGE_SIZE } from '../../shared/constants';

export async function preprocessImage(imagePath: string): Promise<ort.Tensor> {
  // 1. 读取图片
  const buffer = await fs.readFile(imagePath);
  // 2. Resize 到 1536×1536
  const resized = await sharp(buffer)
    .resize(INPUT_IMAGE_SIZE, INPUT_IMAGE_SIZE, { fit: 'fill' })
    .toBuffer();
  // 3. 转换为 Float32Array，归一化到 [0, 1]
  // 4. 转换为 NHWC → NCHW（如果需要）
  // 5. 创建 ONNX Tensor
  // 返回 float32 tensor，shape: [1, 3, 1536, 1536]
}
```

#### 5.4.3 main/inference/postprocess.ts — 后处理：坐标转换

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/inference/postprocess.ts` |
| 单一职责 | 将 ONNX 模型输出的 NDC 空间参数转换为度量空间。ONNX 模型输出的是 NDC 空间中的原始值，需要在此处完成坐标转换。 |
| 导出 | `postprocess(results: ort.InferenceSession.OnnxValueMapType) => RawGaussianParams` |

#### 5.4.4 main/inference/gaussian.ts — 高斯参数与 PLY 生成

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/inference/gaussian.ts` |
| 单一职责 | 对后处理后的参数执行 SVD 分解（从奇异值+四元数恢复协方差矩阵），生成标准 .ply 格式文件。 |
| 导出 | `generatePly(params: RawGaussianParams) => string`（返回 .ply 文件路径） |

> **实现注意：** ONNX 模型输出的是奇异值（singular values）和四元数（quaternions），而非直接可用的协方差矩阵。需要在 JS 端执行 SVD 分解重建协方差。PLY 格式须兼容 GaussianSplats3D 的标准格式。

#### 5.4.5 main/inference/types.ts

```typescript
export interface RawGaussianParams {
  means: Float32Array;          // 形状 [N, 3]
  singularValues: Float32Array; // 形状 [N, 3]
  quaternions: Float32Array;    // 形状 [N, 4]
  colors: Float32Array;         // 形状 [N, 3]
  opacities: Float32Array;      // 形状 [N, 1]
  shCoefficients: Float32Array; // 球谐系数，可选
  count: number;
}
```

### 5.5 模型管理 (main/model/)

#### 5.5.1 main/model/downloader.ts — 模型下载器

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/model/downloader.ts` |
| 单一职责 | 从 Apple CDN 下载 ONNX 模型文件，支持进度回调、断点续传、缓存检测。 |
| 导出 | `class ModelDownloader`。方法：`ensureModel() => Promise<string>`, `download(onProgress) => Promise<string>` |

```typescript
export class ModelDownloader {
  async ensureModel(): Promise<string> {
    const cachePath = this.getCachePath();
    if (await fs.pathExists(cachePath)) {
      const isValid = await validateModel(cachePath);
      if (isValid) return cachePath;
    }
    return this.download((progress) => {
      // 通过 IPC 向渲染进程发送进度
      mainWindow?.webContents.send(IPC_MODEL_DOWNLOAD_PROGRESS, progress);
    });
  }
}
```

#### 5.5.2 main/model/validator.ts — 模型校验器

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/main/model/validator.ts` |
| 单一职责 | 对模型文件执行 SHA256 校验，验证文件完整性。 |
| 导出 | `validateModel(path: string) => Promise<boolean>` |

### 5.6 工具函数 (main/utils/)

| 文件 | 职责 | 导出 |
|------|------|------|
| `logger.ts` | 统一日志（支持级别、文件输出） | `logger` 实例 |
| `paths.ts` | 路径管理（模型缓存、输出目录、临时文件） | `getModelCacheDir()`, `getOutputDir()`, `getTempDir()` |
| `platform.ts` | 平台检测（OS、GPU 后端可用性） | `getPlatform()`, `getAvailableBackend()` |

---

## 6. Preload 脚本规格 (src/preload/)

### 6.1 preload/index.ts — Preload 桥接

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/preload/index.ts` |
| 单一职责 | 通过 contextBridge 向渲染进程安全暴露主进程 API。渲染进程只能通过此文件暴露的 API 与主进程通信。 |

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 推理
  runInference: (imagePath: string) =>
    ipcRenderer.invoke('inference:run', imagePath),
  cancelInference: () =>
    ipcRenderer.invoke('inference:cancel'),

  // 模型
  getModelInfo: () =>
    ipcRenderer.invoke('model:get-info'),
  downloadModel: () =>
    ipcRenderer.invoke('model:download'),
  onModelDownloadProgress: (callback: (p: number) => void) => {
    ipcRenderer.on('model:download-progress', (_e, p) => callback(p));
  },

  // 文件
  openFileDialog: (options?: any) =>
    ipcRenderer.invoke('file:open-dialog', options),
  getFilePath: (type: 'output' | 'model-cache') =>
    ipcRenderer.invoke('file:get-path', type),

  // 应用
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
});

// 类型声明：在渲染进程中可使用 window.electronAPI
export type ElectronAPI = typeof window.electronAPI;
```

---

## 7. 渲染进程规格 (src/renderer/)

### 7.1 renderer/app.ts — 前端入口

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/app.ts` |
| 单一职责 | 初始化所有 UI 模块、事件总线、状态存储。不包含任何业务逻辑。 |
| 导出 | 无 |
| 依赖 | 所有 `ui/` 模块、`state/store.ts`、`state/events.ts` |

```typescript
import { UploadUI } from './ui/upload';
import { ViewerUI } from './ui/viewer';
import { ToolbarUI } from './ui/toolbar';
import { ProgressUI } from './ui/progress';
import { ResultUI } from './ui/result';
import { StatusUI } from './ui/status';
import { appStore } from './state/store';
import { appEvents } from './state/events';

document.addEventListener('DOMContentLoaded', () => {
  // 按照依赖顺序初始化，避免循环依赖
  appStore.initialize();
  const uploadUI = new UploadUI();
  const viewerUI = new ViewerUI();
  const toolbarUI = new ToolbarUI();
  const progressUI = new ProgressUI();
  const resultUI = new ResultUI();
  const statusUI = new StatusUI();

  // 绑定事件
  uploadUI.onFileSelected((path) => appEvents.emit('image:selected', path));
  toolbarUI.onCapture(() => appEvents.emit('capture:requested'));
  // ... 其余事件绑定
});
```

### 7.2 UI 组件 (renderer/ui/)

> **组件设计原则：** 每个 UI 组件负责一个 DOM 区域。组件之间 **不直接引用**，通过事件总线通信。每个组件在自己的文件中完成 DOM 创建、事件绑定和销毁。

#### 7.2.1 upload.ts — 图片上传

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/ui/upload.ts` |
| 单一职责 | 支持三种上传方式：点击选择文件、拖拽文件到区域、从剪贴板粘贴。处理文件类型校验，触发 `image:selected` 事件。 |
| 导出 | `class UploadUI`。方法：`onFileSelected(cb)`, `show()`, `hide()`, `setEnabled(enabled)` |

#### 7.2.2 viewer.ts — 3D 查看器容器

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/ui/viewer.ts` |
| 单一职责 | 创建 3D 渲染的 DOM 容器，管理 Three.js 场景的生命周期。是 UI 层与 three/ 层的桥接。 |
| 导出 | `class ViewerUI`。方法：`loadPly(path)`, `resetCamera()`, `getContainer()`, `destroy()` |

#### 7.2.3 toolbar.ts — 工具栏

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/ui/toolbar.ts` |
| 单一职责 | 提供操作按钮：截图、重置视角、导出场景、设置（外部 API 地址）。 |
| 导出 | `class ToolbarUI`。方法：`onCapture(cb)`, `onReset(cb)`, `onExport(cb)`, `setEnabled(enabled)` |

#### 7.2.4 progress.ts — 进度指示器

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/ui/progress.ts` |
| 单一职责 | 显示推理进度、模型下载进度。支持进度条和百分比文本。 |
| 导出 | `class ProgressUI`。方法：`show(msg)`, `update(percent, msg)`, `hide()` |

#### 7.2.5 result.ts — 结果展示

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/ui/result.ts` |
| 单一职责 | 显示外部 API 处理后的图片结果。支持并排对比（原截图 vs 处理后）和全屏预览。 |
| 导出 | `class ResultUI`。方法：`showResult(imageBlob)`, `showComparison(original, processed)`, `clear()` |

#### 7.2.6 status.ts — 状态栏

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/ui/status.ts` |
| 单一职责 | 显示模型状态（就绪/下载中/未下载）、GPU 后端信息、推理耗时。 |
| 导出 | `class StatusUI`。方法：`setModelStatus(s)`, `setInferenceTime(ms)`, `setBackend(b)` |

### 7.3 3D 渲染引擎 (renderer/three/)

#### 7.3.1 scene.ts — 场景初始化

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/three/scene.ts` |
| 单一职责 | 创建 Three.js 的 Renderer、Scene、Camera。设置 WebGL 参数（包括 preserveDrawingBuffer）。 |
| 导出 | `class SceneManager`。方法：`getRenderer()`, `getScene()`, `getCamera()`, `resize(width, height)`, `dispose()` |

```typescript
import * as THREE from 'three';

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  constructor(container: HTMLElement) {
    // 必须设置 preserveDrawingBuffer 以支持截图
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      preserveDrawingBuffer: true,
    });
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      65, container.clientWidth / container.clientHeight, 0.1, 500
    );
    // 设置默认相机位置
    this.camera.position.set(-1, -4, 6);
    this.camera.up.set(0, -1, -0.6);
    this.camera.lookAt(0, 4, 0);
  }

  getDomElement(): HTMLCanvasElement { return this.renderer.domElement; }
  getRenderer(): THREE.WebGLRenderer { return this.renderer; }
  getScene(): THREE.Scene { return this.scene; }
  getCamera(): THREE.PerspectiveCamera { return this.camera; }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
```

#### 7.3.2 splat-loader.ts — 高斯泼溅加载

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/three/splat-loader.ts` |
| 单一职责 | 封装 GaussianSplats3D 的 Viewer 类。加载 .ply 文件，创建高斯泼溅渲染对象并添加到场景。 |
| 导出 | `class SplatLoader`。方法：`load(plyPath) => Promise<void>`, `unload()`, `getViewer()` |

```typescript
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import type { SceneManager } from './scene';

export class SplatLoader {
  private viewer: GaussianSplats3D.Viewer | null = null;

  constructor(private sceneManager: SceneManager) {}

  async load(plyPath: string): Promise<void> {
    const sm = this.sceneManager;
    // 使用 DropInViewer 模式，将高斯泼溅集成到现有 Three.js 场景
    this.viewer = new GaussianSplats3D.DropInViewer({
      gpuAcceleratedSort: true,
      integerBasedSort: true,
      sphericalHarmonicsDegree: 0,
      sharedMemoryForWorkers: true,
    });
    this.viewer.addSplatScene(plyPath, {
      splatAlphaRemovalThreshold: 5,
      showLoadingUI: true,
    });
    sm.getScene().add(this.viewer);
  }

  getViewer(): GaussianSplats3D.Viewer | null { return this.viewer; }

  unload(): void {
    this.viewer?.dispose();
    this.viewer = null;
  }
}
```

#### 7.3.3 controls.ts — 相机控制

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/three/controls.ts` |
| 单一职责 | 封装 OrbitControls 或自定义相机控制器。处理用户交互（旋转、缩放、平移），并暴露相机状态查询接口。 |
| 导出 | `class CameraController`。方法：`reset()`, `getCameraState() => CameraState`, `setCameraState(state)`, `dispose()` |

```typescript
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Camera, WebGLRenderer } from 'three';

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  zoom: number;
}

export class CameraController {
  private controls: OrbitControls;

  constructor(camera: Camera, renderer: WebGLRenderer) {
    this.controls = new OrbitControls(camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
  }

  reset(): void {
    this.controls.target.set(0, 4, 0);
    this.controls.update();
  }

  getCameraState(): CameraState {
    return {
      position: this.controls.object.position.toArray() as [number, number, number],
      target: this.controls.target.toArray() as [number, number, number],
      zoom: this.controls.object.zoom,
    };
  }

  update(): void { this.controls.update(); }
  dispose(): void { this.controls.dispose(); }
}
```

#### 7.3.4 capture.ts — 截图功能

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/three/capture.ts` |
| 单一职责 | 从 WebGLRenderer 的 Canvas 中捕获当前帧为 PNG Blob。 |
| 导出 | `captureViewport(renderer: WebGLRenderer) => Promise<Blob>` |

```typescript
import type { WebGLRenderer } from 'three';

export function captureViewport(renderer: WebGLRenderer): Promise<Blob> {
  return new Promise((resolve, reject) => {
    renderer.domElement.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('截图失败：Canvas 为空'));
      },
      'image/png',
      1.0 // 最高质量
    );
  });
}
```

#### 7.3.5 types.ts

```typescript
export interface PlyLoadOptions {
  splatAlphaRemovalThreshold?: number;
  showLoadingUI?: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

export { CameraState } from './controls';
```

### 7.4 API 通信层 (renderer/api/)

#### 7.4.1 ipc.ts — IPC 调用封装

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/api/ipc.ts` |
| 单一职责 | 封装所有对 `window.electronAPI` 的调用，提供类型安全的接口。渲染进程其他模块通过此文件与主进程通信，而非直接调用 `window.electronAPI`。 |
| 导出 | `inferenceAPI`, `modelAPI`, `fileAPI`, `appAPI` |

```typescript
export const inferenceAPI = {
  run: (imagePath: string) => window.electronAPI.runInference(imagePath),
  cancel: () => window.electronAPI.cancelInference(),
};

export const modelAPI = {
  getInfo: () => window.electronAPI.getModelInfo(),
  download: () => window.electronAPI.downloadModel(),
  onDownloadProgress: (cb: (p: number) => void) =>
    window.electronAPI.onModelDownloadProgress(cb),
};

export const fileAPI = {
  openDialog: (options?: any) => window.electronAPI.openFileDialog(options),
  getPath: (type: 'output' | 'model-cache') => window.electronAPI.getFilePath(type),
};

export const appAPI = {
  getPlatform: () => window.electronAPI.getPlatform(),
  getVersion: () => window.electronAPI.getAppVersion(),
};
```

#### 7.4.2 external.ts — 外部 API 调用

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/api/external.ts` |
| 单一职责 | 将截图 Blob 发送至用户配置的外部 API，返回处理后的图片。 |
| 导出 | `sendToExternalAPI(blob: Blob, config: ExternalApiConfig) => Promise<Blob>` |

```typescript
import type { ExternalApiConfig } from '../../shared/types';
import { DEFAULT_EXTERNAL_API_TIMEOUT } from '../../shared/constants';

export async function sendToExternalAPI(
  imageBlob: Blob,
  config: ExternalApiConfig
): Promise<Blob> {
  const formData = new FormData();
  formData.append(config.fieldName, imageBlob, 'screenshot.png');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_EXTERNAL_API_TIMEOUT);

  const response = await fetch(config.url, {
    method: config.method,
    headers: config.headers,
    body: formData,
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`外部 API 返回错误: ${response.status}`);
  }
  return response.blob();
}
```

### 7.5 状态管理 (renderer/state/)

#### 7.5.1 store.ts — 全局状态

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/state/store.ts` |
| 单一职责 | 维护应用全局状态，提供只读访问和通过 reducer 更新。不包含任何 UI 逻辑。 |
| 导出 | `appStore` 实例。方法：`getState()`, `dispatch(action)`, `subscribe(listener)` |

```typescript
import type { AppState, AppError } from '../../shared/types';

type AppAction =
  | { type: 'SET_PHASE'; phase: AppState['phase'] }
  | { type: 'SET_INPUT_IMAGE'; path: string }
  | { type: 'SET_PLY'; path: string }
  | { type: 'SET_ERROR'; error: AppError }
  | { type: 'CLEAR_ERROR' }
  | { type: 'RESET' };

const initialState: AppState = {
  phase: 'idle',
  inputImagePath: null,
  plyPath: null,
  error: null,
};

class AppStore {
  private state: AppState = { ...initialState };
  private listeners: Array<(s: AppState) => void> = [];

  getState(): Readonly<AppState> { return this.state; }

  dispatch(action: AppAction): void {
    switch (action.type) {
      case 'SET_PHASE':
        this.state = { ...this.state, phase: action.phase };
        break;
      // ... 其他 case
    }
    this.listeners.forEach(fn => fn(this.state));
  }

  subscribe(listener: (s: AppState) => void): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter(l => l !== listener); };
  }
}

export const appStore = new AppStore();
```

#### 7.5.2 events.ts — 事件总线

| 属性 | 说明 |
|------|------|
| 文件路径 | `src/renderer/state/events.ts` |
| 单一职责 | 发布/订阅事件总线，用于 UI 组件间解耦通信。所有跨组件通信通过此总线。 |
| 导出 | `appEvents` 实例。方法：`on(event, cb)`, `off(event, cb)`, `emit(event, data)` |

```typescript
type EventHandler = (...args: any[]) => void;

class EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.forEach(handler => handler(...args));
  }
}

export const appEvents = new EventBus();
```

#### 7.5.3 types.ts

```typescript
// 事件名称常量
export const Events = {
  IMAGE_SELECTED: 'image:selected',
  INFERENCE_START: 'inference:start',
  INFERENCE_COMPLETE: 'inference:complete',
  INFERENCE_ERROR: 'inference:error',
  MODEL_DOWNLOAD_PROGRESS: 'model:download-progress',
  CAPTURE_REQUESTED: 'capture:requested',
  CAPTURE_COMPLETE: 'capture:complete',
  EXTERNAL_API_RESULT: 'external:api-result',
  EXTERNAL_API_ERROR: 'external:api-error',
  APP_ERROR: 'app:error',
} as const;
```

---

## 8. IPC 协议完整定义

> **使用规则：** 渲染进程调用 `ipcRenderer.invoke(channel, ...args)`，主进程通过 `ipcMain.handle(channel, handler)` 响应。所有 channel 名称和参数类型必须与 `shared/ipc-channels.ts` 和 `shared/types.ts` 一致。

| Channel | 方向 | 请求参数 | 响应类型 |
|---------|------|----------|----------|
| `inference:run` | 渲染→主 | `imagePath: string` | `InferenceResult \| AppError` |
| `inference:cancel` | 渲染→主 | 无 | `void` |
| `model:get-info` | 渲染→主 | 无 | `ModelInfo` |
| `model:download` | 渲染→主 | 无 | `string`（模型路径） |
| `model:validate` | 渲染→主 | `path: string` | `boolean` |
| `file:open-dialog` | 渲染→主 | `options?: OpenDialogOptions` | `OpenDialogReturnValue` |
| `file:get-path` | 渲染→主 | `type: 'output' \| 'model-cache'` | `string` |
| `app:get-platform` | 渲染→主 | 无 | `string` |
| `app:get-version` | 渲染→主 | 无 | `string` |
| `model:download-progress` | 主→渲染（单向推送） | `percent: number` | — |
| `inference:progress` | 主→渲染（单向推送） | `stage: string` | — |

---

## 9. 错误处理规范

### 9.1 错误分类

| 错误类别 | 处理策略 | 用户提示 |
|----------|----------|----------|
| 模型未下载 | 自动触发下载，显示进度 | "正在下载模型（约 2.4 GB），请稍候…" |
| 模型下载失败 | 提供重试按钮，保留部分下载进度 | "模型下载失败，请检查网络后重试" |
| 模型校验失败 | 删除损坏文件，重新下载 | "模型文件损坏，正在重新下载…" |
| 推理失败 | 记录日志，提示用户，允许重试 | "推理失败: {具体原因}" |
| 不支持的图片格式 | 前端校验 + 后端校验 | "不支持的图片格式，请使用 JPG/PNG/HEIC" |
| 外部 API 超时 | 30s 超时，提供重试 | "外部 API 请求超时，请检查网络后重试" |
| 外部 API 错误 | 显示 HTTP 状态码和错误信息 | "外部 API 返回错误 ({status})" |

### 9.2 错误处理原则

- 所有 try-catch 必须记录完整错误堆栈到 logger
- 用户可见的错误信息使用中文，不暴露技术细节
- IPC handler 中的错误统一返回 `AppError` 类型，不抛出异常
- 渲染进程收到 AppError 后，通过事件总线广播 `app:error`
- 每个可恢复错误提供重试入口

---

## 10. 构建与打包配置

### 10.1 package.json 关键字段

```json
{
  "name": "sharp-viewer",
  "version": "1.0.0",
  "main": "dist/main/index.js",
  "scripts": {
    "dev": "concurrently \"npm run dev:main\" \"npm run dev:renderer\"",
    "dev:main": "tsc -p tsconfig.main.json && electron .",
    "dev:renderer": "esbuild src/renderer/app.ts --bundle --outdir=dist/renderer --watch",
    "build": "tsc -p tsconfig.main.json && esbuild src/renderer/app.ts --bundle --minify --outdir=dist/renderer",
    "pack": "electron-builder --dir",
    "dist": "electron-builder"
  },
  "dependencies": {
    "onnxruntime-node": "^1.20.0",
    "sharp": "^0.33.0",
    "three": "^0.170.0",
    "@mkkellogg/gaussian-splats-3d": "^0.4.7"
  },
  "devDependencies": {
    "electron": "^32.0.0",
    "electron-builder": "^25.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.5.0",
    "concurrently": "^9.0.0",
    "@types/three": "^0.170.0"
  }
}
```

### 10.2 electron-builder.yml

```yaml
appId: com.sharpviewer.app
productName: SHARP Viewer
directories:
  output: release
  buildResources: assets
files:
  - dist/**/*
  - assets/**/*
extraResources:
  - from: models/
    to: models/
    filter:
      - "*.onnx"
      - "*.onnx.data"
mac:
  target: [dmg, zip]
  category: public.app-category.graphics-design
win:
  target: [nsis, portable]
linux:
  target: [AppImage, deb]
  category: Graphics
asar: true
asarUnpack:
  - "node_modules/onnxruntime-node/**/*"
  - "node_modules/sharp/**/*"
```

### 10.3 tsconfig 分层

| 文件 | 用途 | 关键配置 |
|------|------|----------|
| `tsconfig.json` | 基础配置（共享） | `strict: true`, `target: ES2022`, `moduleResolution: bundler` |
| `tsconfig.main.json` | 主进程 | `module: commonjs`, `outDir: dist/main`, `include: src/main, src/shared, src/preload` |
| `tsconfig.renderer.json` | 渲染进程 | `module: esnext`, `outDir: dist/renderer`, `include: src/renderer, src/shared` |

---

## 11. ONNX 模型导出

### 11.1 导出脚本

| 属性 | 说明 |
|------|------|
| 文件路径 | `scripts/export-onnx.py` |
| 单一职责 | 将 SHARP 的 PyTorch 模型导出为 ONNX 格式。参考 bring-shrubbery/ml-sharp-web 的实现。 |

```python
import torch
import torch.onnx
from sharp.model import SharpPredictor

# 1. 加载预训练权重
model = SharpPredictor()
model.load_state_dict(torch.load('sharp_2572gikvuh.pt'))
model.eval()

# 2. 创建 dummy input
dummy_input = torch.randn(1, 3, 1536, 1536)

# 3. 导出（注意：仅导出预测器，跳过 SVD 和坐标转换）
torch.onnx.export(
    model,
    dummy_input,
    'sharp_predictor.onnx',
    opset_version=20,
    input_names=['input'],
    output_names=['means', 'singular_values', 'quaternions', 'colors', 'opacities'],
    dynamic_axes={'input': {0: 'batch'}},
)

# 4. 计算 SHA256
import hashlib
sha256 = hashlib.sha256(open('sharp_predictor.onnx', 'rb').read()).hexdigest()
print(f'Model SHA256: {sha256}')
```

> **关键注意事项：** 导出时仅导出预测器网络（编码器+解码器），SVD 分解和 NDC→度量空间转换在 JS 端完成。这样做的原因是 ONNX Runtime Web/Node 对 SVD 算子支持不完整。

---

## 12. 解耦原则总结

### 12.1 分层架构

```
Layer 1: src/shared/         (types.ts, ipc-channels.ts, constants.ts)
    │
    ▼
Layer 2: src/main/           (ipc/, inference/, model/, utils/)
    │
    ▼
Layer 3: src/preload/        (index.ts)
    │
    ▼
Layer 4: src/renderer/       (ui/, three/, api/, state/)
```

依赖方向严格自上而下，不可逆。

### 12.2 模块通信规则

| 模块 A | 模块 B | 通信方式 |
|--------|--------|----------|
| UI 组件之间 | UI 组件之间 | 事件总线（`appEvents`） |
| UI 组件 | 3D 渲染层 | 直接方法调用（UI 持有引用） |
| UI 组件 | 状态存储 | `appStore.getState()` + `appStore.subscribe()` |
| 渲染进程 | 主进程 | IPC（通过 `api/ipc.ts` 封装） |
| 主进程模块之间 | 主进程模块之间 | 直接依赖注入 |

### 12.3 文件大小约束

| 约束 | 阈值 | 超标处理 |
|------|------|----------|
| 单文件最大行数 | 300 行 | 拆分为多个文件，提取公共逻辑 |
| 单函数最大行数 | 50 行 | 提取子函数 |
| 单模块最大导出 | 10 个 | 拆分为子模块 |

### 12.4 修改影响范围

| 修改内容 | 最大影响范围 |
|----------|------------|
| 修改 `shared/types.ts` 中的接口 | 需要同步修改所有引用该接口的文件（通过 TypeScript 编译检查） |
| 修改 UI 组件内部实现 | 仅影响该组件文件，不影响其他组件 |
| 修改 `inference/engine.ts` 内部逻辑 | 仅影响 `engine.ts`，外部接口不变 |
| 新增 IPC channel | 需同步修改 `ipc-channels.ts`、`ipc/` handler、`api/ipc.ts`、`preload/index.ts` |
| 修改 3D 渲染逻辑 | 仅影响 `three/` 目录内文件 |

---

## 13. 开发路线图

| 阶段 | 周期 | 任务 | 产出 |
|------|------|------|------|
| **Phase 1** 核心验证 | 1-2 周 | 1. 导出 SHARP 为 ONNX<br>2. 在 Node.js 中验证 onnxruntime-node 推理<br>3. 验证预处理/后处理逻辑正确性<br>4. 验证 .ply 生成可在 GaussianSplats3D 中加载 | 可工作的 ONNX 推理脚本 + 生成的 .ply 文件 |
| **Phase 2** 渲染集成 | 1-2 周 | 1. 搭建 Electron 项目骨架<br>2. 实现 shared/ 层<br>3. 实现 preload/ 和 IPC 通信<br>4. 实现 three/ 层（场景、加载、控制）<br>5. 实现基础 UI 组件 | Electron 窗口内可交互的 3D 场景 |
| **Phase 3** 完整流程 | 1 周 | 1. 实现推理引擎与 IPC 对接<br>2. 实现模型下载与管理<br>3. 实现截图功能<br>4. 实现外部 API 调用<br>5. 端到端集成测试 | 完整可用的桌面应用 |
| **Phase 4** 打包发布 | 1-2 周 | 1. 配置 electron-builder<br>2. 解决 onnxruntime-node 的 native 模块打包<br>3. 多平台测试<br>4. 安装器制作 | 可分发安装包 |
| **Phase 5** 优化 | 持续 | 1. 推理性能优化<br>2. 大场景加载优化<br>3. 移动端适配研究 | — |

---

*SHARP Viewer 技术规格说明书 v2.0 · 2026 年 6 月*
*本文档可作为 AI 编程工具的输入，按模块顺序逐一实现*