# 照片重构 / Photo Reframing

[![下载最新版本](https://img.shields.io/badge/下载-最新版本-2ea44f?style=for-the-badge)](../../releases/latest)

照片重构（Photo Reframing）是一款基于 Electron、ONNX Runtime 与 Three.js 的桌面应用。项目的主要目的，是在桌面端实验性复刻 iOS 27 上的 Spatial Reframing 体验：从单张照片估计 3D 结构，生成可交互浏览的 Gaussian Splat 视图，并调用图片编辑模型 API 进行细化。

本项目是一个实验项目，存在许多不足。

## 核心能力

- 单图推理生成 3D Gaussian Splat 点云/泼溅结果
- 内置查看器，可旋转、缩放、重置视角
- 支持 JPG、PNG、HEIC、HEIF、WEBP 上传
- 支持基于 KIE 的二次图像重构
- 支持两种打包模式：
  - 轻量包：安装包不内置模型，首次运行时下载模型
  - 完整离线包：安装包内置模型，适合本地分发或离线环境

## 项目来源与参考

这个项目的核心能力并不是从零开始发明，而是在若干开源项目基础上做工程整合、桌面化封装与交互适配。

### 直接使用或强相关的项目

- [apple/ml-sharp](https://github.com/apple/ml-sharp)
  SHARP 模型与整体思路来源，也是本项目尝试复刻 Spatial Reframing 体验的核心起点。
- [sparkjsdev/spark](https://github.com/sparkjsdev/spark)
  当前项目实际使用的 Gaussian Splat 渲染器，仓库中通过 `@sparkjsdev/spark`、`SparkRenderer` 和 `SplatMesh` 接入。
- [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime)
  通过 `onnxruntime-node` 承担本地模型推理。
- [mrdoob/three.js](https://github.com/mrdoob/three.js)
  负责基础 3D 场景、相机、控制器与渲染管线。

### 交互与视觉实现参考

- [gobinda-das-dev/image-generate-fx-webgl](https://github.com/gobinda-das-dev/image-generate-fx-webgl)
  等待态图片扰动与柔焦效果的实现灵感来源之一。
- [rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)
  玻璃质感按钮/面板的视觉表达参考之一。
- [iyinchao/liquid-glass-studio](https://github.com/iyinchao/liquid-glass-studio)
  同样为当前界面的液态玻璃风格提供了视觉参考。

## 技术栈

- Electron
- TypeScript
- electron-vite
- Three.js
- `@sparkjsdev/spark`
- `onnxruntime-node`
- `sharp`

## 本地开发

### 安装依赖

```bash
npm ci
```

### 启动开发环境

```bash
npm run dev
```

### 常用脚本

```bash
npm run build
npm run smoke:ipc
npm run smoke:viewer
```

## 打包命令

### 轻量安装包

默认构建不内置模型，适合 GitHub Release。

```bash
npm run dist
```

### 完整离线安装包

这条命令会把本地 `models/` 中的模型一起打进安装包，适合本地交付、内网分发或 U 盘拷贝。

```bash
npm run dist:full
```

### 仅生成 unpacked 目录

```bash
npm run pack
npm run pack:full
```

## 模型策略

项目当前模型文件包含：

- `models/sharp_web_predictor.onnx`
- `models/sharp_web_predictor.onnx.data`

运行时会按下面的顺序寻找模型：

1. 如果安装包内已经附带模型，优先直接使用内置模型。
2. 如果安装包未附带模型，则在用户目录下创建模型缓存并下载模型。
3. 开发模式下优先使用仓库根目录下的 `models/`。

这样同一套代码可以同时支持“轻量发布”和“完整离线包”。

## GitHub Release 发布

仓库已经提供 GitHub Actions 工作流：

- 触发方式：推送 `v*` 标签
- 行为：自动构建 Windows / macOS / Linux 安装包并上传到 GitHub Release
- 默认策略：**不内置模型**
- 下载入口：README 顶部“下载最新版本”按钮会跳转到最新 Release 页面

示例：

```bash
git tag v1.0.0
git push origin v1.0.0
```

工作流文件：

- [`.github/workflows/release.yml`](.github/workflows/release.yml)

## 为什么 GitHub Release 默认不打包模型

当前 `.onnx.data` 权重文件体积约为 2.44 GiB，已经非常接近甚至超过 GitHub 常见分发链路的安全范围。对这个项目来说，默认走“轻量包 + 首次下载模型”是最稳妥的发布方式。

更具体地说：

- 普通 GitHub 仓库单文件限制是 100 MiB，模型不能直接作为普通 Git 文件提交
- GitHub Release 单个资产文件必须小于 2 GiB
- 当前模型权重本体已经大于 2 GiB 量级，因此“所有模型直接打进 GitHub Release 安装包”风险很高

所以推荐策略是：

- GitHub 公网发布：使用 `npm run dist`
- 本地完整离线交付：使用 `npm run dist:full`

## 目录说明

```text
src/main            Electron 主进程
src/renderer        前端界面与 Three.js 查看器
src/backend         推理 Worker 与底层推理逻辑
src/main/model      模型下载与校验
models              本地模型目录
assets              图标与打包资源
scripts             开发与构建辅助脚本
```

## 备注

- 软件中文名：照片重构
- 软件英文名：Photo Reframing
- 项目目标：实验性复刻 iOS 27 上的 Spatial Reframing 体验