"""
SHARP 模型导出脚本
将 PyTorch 模型导出为 ONNX 格式 (opset 20)

使用方式:
    python scripts/export-onnx.py --model sharp_2572gikvuh.pt --output sharp_predictor.onnx

参考: bring-shrubbery/ml-sharp-web
"""

import argparse
import hashlib
import torch
import torch.onnx


def export_model(model_path: str, output_path: str):
    """
    导出 SHARP 预测器为 ONNX 格式。

    注意：仅导出预测器网络（编码器+解码器），SVD 分解和 NDC→度量空间转换
    在 JS 端完成。原因是 ONNX Runtime Web/Node 对 SVD 算子支持不完整。
    """
    # 1. 加载预训练权重
    model = torch.jit.load(model_path)
    model.eval()

    # 2. 创建 dummy input
    dummy_input = torch.randn(1, 3, 1536, 1536)

    # 3. 导出 ONNX
    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        opset_version=20,
        input_names=['input'],
        output_names=[
            'means',
            'singular_values',
            'quaternions',
            'colors',
            'opacities',
        ],
        dynamic_axes={'input': {0: 'batch'}},
    )

    # 4. 计算 SHA256
    with open(output_path, 'rb') as f:
        sha256 = hashlib.sha256(f.read()).hexdigest()

    print(f"ONNX 模型已导出: {output_path}")
    print(f"SHA256: {sha256}")

    # 更新 shared/constants.ts 中的 EXPECTED_MODEL_SHA256
    print(f"\n请将以下 SHA256 值填入 src/shared/constants.ts 的 EXPECTED_MODEL_SHA256:")
    print(f'  export const EXPECTED_MODEL_SHA256 = "{sha256}";')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='导出 SHARP 模型为 ONNX')
    parser.add_argument('--model', required=True, help='PyTorch 模型文件路径')
    parser.add_argument('--output', default='sharp_predictor.onnx', help='输出 ONNX 文件路径')
    args = parser.parse_args()

    export_model(args.model, args.output)