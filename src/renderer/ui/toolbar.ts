// ============================================================
// renderer/ui/toolbar.ts — 工具栏
// 提供操作按钮：截图、重置视角、导出场景、设置
// ============================================================

import { appEvents } from '../state/events';
import { Events } from '../state/types';

export class ToolbarUI {
  private container: HTMLElement;
  private enabled = false;

  constructor() {
    this.container = this.createContainer();
    this.bindEvents();
    this.mount();
  }

  private createContainer(): HTMLElement {
    const existing = document.getElementById('toolbar');
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = 'toolbar';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = `
      <button id="btn-capture" class="toolbar-btn" title="截图">
        📷 截图
      </button>
      <button id="btn-reset" class="toolbar-btn" title="重置视角">
        🔄 重置视角
      </button>
      <button id="btn-reupload" class="toolbar-btn" title="重新上传图片">
        重新上传
      </button>
      <div class="toolbar-spacer"></div>
      <button id="btn-settings" class="toolbar-btn" title="设置">
        ⚙️ 设置
      </button>
    `;
    return el;
  }

  private bindEvents(): void {
    this.container.querySelector('#btn-capture')?.addEventListener('click', () => {
      if (this.enabled) {
        appEvents.emit(Events.CAPTURE_REQUESTED);
      }
    });

    this.container.querySelector('#btn-reset')?.addEventListener('click', () => {
      if (this.enabled) {
        appEvents.emit('viewer:reset');
      }
    });

    this.container.querySelector('#btn-reupload')?.addEventListener('click', () => {
      if (this.enabled) {
        appEvents.emit(Events.UPLOAD_REQUESTED);
      }
    });

    this.container.querySelector('#btn-settings')?.addEventListener('click', () => {
      appEvents.emit('settings:open');
    });
  }

  private mount(): void {
    const app = document.getElementById('app');
    if (app) app.appendChild(this.container);
  }

  onCapture(cb: () => void): void {
    appEvents.on(Events.CAPTURE_REQUESTED, cb);
  }

  onReset(cb: () => void): void {
    appEvents.on('viewer:reset', cb);
  }

  onExport(cb: () => void): void {
    appEvents.on('viewer:export', cb);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.container.classList.toggle('is-visible', enabled);
    this.container.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  }
}
