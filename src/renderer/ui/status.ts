// ============================================================
// renderer/ui/status.ts — 状态栏
// 显示模型状态、GPU 后端信息、推理耗时
// ============================================================

export class StatusUI {
  private container: HTMLElement;
  private modelStatus: HTMLElement;
  private backendInfo: HTMLElement;
  private inferenceTime: HTMLElement;

  constructor() {
    this.container = this.createContainer();
    this.modelStatus = this.container.querySelector('#status-model')!;
    this.backendInfo = this.container.querySelector('#status-backend')!;
    this.inferenceTime = this.container.querySelector('#status-time')!;
    this.mount();
  }

  private createContainer(): HTMLElement {
    const existing = document.getElementById('status-bar');
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = 'status-bar';
    el.innerHTML = `
      <span id="status-model" class="status-item">模型: 未就绪</span>
      <span id="status-backend" class="status-item">后端: --</span>
      <span id="status-time" class="status-item">耗时: --</span>
    `;
    return el;
  }

  private mount(): void {
    const app = document.getElementById('app');
    if (app) app.appendChild(this.container);
  }

  setModelStatus(status: string): void {
    this.modelStatus.textContent = `模型: ${status}`;
  }

  setInferenceTime(ms: number): void {
    this.inferenceTime.textContent = `耗时: ${ms}ms`;
  }

  setBackend(backend: string): void {
    this.backendInfo.textContent = `后端: ${backend}`;
  }
}