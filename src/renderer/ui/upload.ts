// ============================================================
// renderer/ui/upload.ts — 图片上传组件
// 支持三种上传方式：点击选择文件、拖拽文件到区域、从剪贴板粘贴
// ============================================================

import { appEvents } from '../state/events';
import { Events } from '../state/types';
import { fileAPI } from '../api/ipc';

export class UploadUI {
  private container: HTMLElement;
  private dropZone: HTMLElement;
  private fileInput: HTMLInputElement;
  private enabled = true;
  private objectUrl: string | null = null;

  constructor() {
    this.container = this.createContainer();
    this.dropZone = this.createDropZone();
    this.fileInput = this.createFileInput();
    this.container.appendChild(this.dropZone);
    this.bindEvents();
    this.mount();
  }

  private createContainer(): HTMLElement {
    const el = document.getElementById('upload-area');
    if (el) return el;
    const div = document.createElement('div');
    div.id = 'upload-area';
    return div;
  }

  private createDropZone(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'upload-dropzone';
    el.innerHTML = `
      <div class="upload-icon">📁</div>
      <div class="upload-text">拖拽图片到此处</div>
      <div class="upload-subtext">支持 JPG / PNG / HEIC 格式</div>
      <button class="upload-btn">选择图片</button>
    `;
    return el;
  }

  private createFileInput(): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/heic,image/heif,image/webp';
    input.style.display = 'none';
    this.container.appendChild(input);
    return input;
  }

  private bindEvents(): void {
    this.dropZone.addEventListener('click', () => {
      if (!this.enabled) return;
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      if (file) this.handleFile(file);
    });

    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('drag-over');
    });

    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('drag-over');
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file && this.enabled) this.handleFile(file);
    });

    document.addEventListener('paste', (e) => {
      if (!this.enabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) this.handleFile(file);
          break;
        }
      }
    });
  }

  private handleFile(file: File): void {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const supported = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp'];
    if (!ext || !supported.includes(ext)) {
      appEvents.emit(Events.APP_ERROR, {
        code: 'UNSUPPORTED_IMAGE_FORMAT',
        message: '不支持的图片格式，请使用 JPG/PNG/HEIC',
        detail: `文件扩展名: .${ext}`,
      });
      return;
    }

    try {
      this.setReferenceObjectUrl(file);
      const imagePath = fileAPI.getPathForFile(file);
      if (imagePath) {
        appEvents.emit(Events.IMAGE_SELECTED, imagePath);
      } else {
        appEvents.emit(Events.APP_ERROR, {
          code: 'FILE_READ_ERROR',
          message: '无法读取文件路径',
          detail: '文件路径不可用',
        });
      }
    } catch (err) {
      appEvents.emit(Events.APP_ERROR, {
        code: 'FILE_READ_ERROR',
        message: '无法读取文件路径',
        detail: String(err),
      });
    }
  }

  onFileSelected(cb: (path: string) => void): void {
    appEvents.on(Events.IMAGE_SELECTED, cb);
  }

  private setReferenceObjectUrl(file: File): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    appEvents.emit(Events.REFERENCE_IMAGE_READY, this.objectUrl);
  }

  private mount(): void {
    const app = document.getElementById('app');
    if (app) {
      app.appendChild(this.container);
    }
  }

  show(): void {
    this.container.style.display = '';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.dropZone.style.opacity = enabled ? '1' : '0.5';
    this.dropZone.style.pointerEvents = enabled ? 'auto' : 'none';
  }
}
