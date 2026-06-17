#!/bin/bash
# ============================================================
# scripts/dev-setup.sh — 开发环境初始化
# ============================================================

set -e

echo "=== SHARP Viewer 开发环境初始化 ==="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请安装 Node.js >= 18"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
echo "Node.js 版本: $(node -v)"

if [ "$NODE_VERSION" -lt 18 ]; then
    echo "警告: 推荐使用 Node.js >= 18"
fi

# 安装依赖
echo ""
echo "安装项目依赖..."
npm install

# 创建必要目录
echo ""
echo "创建运行时目录..."
mkdir -p models output

# 检查 ONNX 模型
echo ""
if [ -f "models/sharp_predictor.onnx" ]; then
    echo "ONNX 模型已存在: models/sharp_predictor.onnx"
else
    echo "ONNX 模型不存在，启动应用后将自动下载"
    echo "你也可以手动将模型放入 models/ 目录"
fi

# 构建项目
echo ""
echo "构建项目..."
npm run build

echo ""
echo "=== 初始化完成 ==="
echo ""
echo "运行开发模式:"
echo "  npm run dev"
echo ""
echo "构建生产版本:"
echo "  npm run build"
echo ""
echo "打包应用:"
echo "  npm run dist"