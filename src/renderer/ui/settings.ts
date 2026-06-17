// ============================================================
// renderer/ui/settings.ts — 调参设置面板
// ============================================================

import {
  DEFAULT_MAX_GAUSSIANS_BALANCED,
  DEFAULT_MAX_GAUSSIANS_HIGH,
  DEFAULT_MAX_SCREEN_SPACE_SPLAT_SIZE,
  DEFAULT_OPACITY_THRESHOLD,
  DEFAULT_POINT_CLOUD_MODE,
  DEFAULT_SPLAT_ALPHA_REMOVAL_THRESHOLD,
  DEFAULT_SPLAT_SCALE,
  DEFAULT_VIEWER_BACKGROUND,
  DEFAULT_VIEWER_FOV,
} from '../../shared/constants';
import type { ViewerSettings } from '../../shared/types';

export const defaultViewerSettings: ViewerSettings = {
  qualityPreset: 'high',
  opacityThreshold: DEFAULT_OPACITY_THRESHOLD,
  maxGaussians: DEFAULT_MAX_GAUSSIANS_HIGH,
  focalPxOverride: null,
  splatAlphaRemovalThreshold: DEFAULT_SPLAT_ALPHA_REMOVAL_THRESHOLD,
  splatScale: DEFAULT_SPLAT_SCALE,
  maxScreenSpaceSplatSize: DEFAULT_MAX_SCREEN_SPACE_SPLAT_SIZE,
  pointCloudMode: DEFAULT_POINT_CLOUD_MODE,
  backgroundColor: DEFAULT_VIEWER_BACKGROUND,
  fov: DEFAULT_VIEWER_FOV,
  externalApiUrl: '',
};

type ApplyCallback = (settings: ViewerSettings) => void;

export class SettingsUI {
  private container: HTMLElement;
  private form: HTMLFormElement;
  private settings: ViewerSettings = { ...defaultViewerSettings };
  private applyCallbacks: ApplyCallback[] = [];

  constructor() {
    this.container = this.createContainer();
    this.form = this.container.querySelector('#settings-form') as HTMLFormElement;
    this.mount();
    this.bindEvents();
    this.syncForm();
  }

  getSettings(): ViewerSettings {
    return { ...this.settings };
  }

  onApply(callback: ApplyCallback): void {
    this.applyCallbacks.push(callback);
  }

  open(): void {
    this.container.style.display = 'block';
  }

  close(): void {
    this.container.style.display = 'none';
  }

  private createContainer(): HTMLElement {
    const existing = document.getElementById('settings-panel');
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = 'settings-panel';
    el.innerHTML = `
      <div class="settings-backdrop" data-settings-close></div>
      <aside class="settings-drawer" aria-label="设置">
        <div class="settings-header">
          <div>
            <div class="settings-title">设置</div>
            <div class="settings-subtitle">调整后可继续上传同一张图对比</div>
          </div>
          <button type="button" class="settings-close" data-settings-close title="关闭">×</button>
        </div>
        <form id="settings-form" class="settings-form">
          <section class="settings-section">
            <h3>推理</h3>
            <label class="setting-row">
              <span>质量预设</span>
              <select name="qualityPreset">
                <option value="balanced">Balanced · 20万</option>
                <option value="high">High · 50万</option>
                <option value="full">Full · 不封顶</option>
              </select>
            </label>
            <label class="setting-row">
              <span>最大高斯数</span>
              <input name="maxGaussians" type="number" min="0" max="3000000" step="50000" />
            </label>
            <label class="setting-row">
              <span>透明度阈值</span>
              <input name="opacityThreshold" type="range" min="0" max="0.1" step="0.001" />
              <output data-for="opacityThreshold"></output>
            </label>
            <label class="setting-row">
              <span>焦距覆盖 px</span>
              <input name="focalPxOverride" type="number" min="0" step="1" placeholder="自动" />
            </label>
            <p class="settings-note">推理参数在下一次上传图片时生效。</p>
          </section>

          <section class="settings-section">
            <h3>渲染</h3>
            <label class="setting-row">
              <span>高斯缩放</span>
              <input name="splatScale" type="range" min="0.01" max="1000" step="0.01" />
              <output data-for="splatScale"></output>
            </label>
            <label class="setting-row">
              <span>Alpha 裁剪</span>
              <input name="splatAlphaRemovalThreshold" type="range" min="0" max="30" step="1" />
              <output data-for="splatAlphaRemovalThreshold"></output>
            </label>
            <label class="setting-row">
              <span>最大屏幕尺寸</span>
              <input name="maxScreenSpaceSplatSize" type="number" min="128" max="8192" step="128" />
            </label>
            <label class="setting-row">
              <span>视场角</span>
              <input name="fov" type="range" min="25" max="100" step="1" />
              <output data-for="fov"></output>
            </label>
            <label class="setting-row setting-row-inline">
              <span>背景</span>
              <input name="backgroundColor" type="color" />
            </label>
            <label class="setting-toggle">
              <input name="pointCloudMode" type="checkbox" />
              <span>点云模式</span>
            </label>
            <p class="settings-note">渲染参数会实时更新当前视图。</p>
          </section>

          <section class="settings-section">
            <h3>输出</h3>
            <label class="setting-row setting-row-inline">
              <span>外部 API</span>
              <input name="externalApiUrl" type="url" placeholder="留空则仅保存截图" />
            </label>
          </section>

          <div class="settings-actions">
            <button type="button" class="settings-secondary" data-settings-reset>重置默认</button>
            <button type="submit" class="settings-primary">完成</button>
          </div>
        </form>
      </aside>
    `;
    return el;
  }

  private mount(): void {
    const app = document.getElementById('app');
    if (app) app.appendChild(this.container);
  }

  private bindEvents(): void {
    this.container.querySelectorAll('[data-settings-close]').forEach((button) => {
      button.addEventListener('click', () => this.close());
    });
    this.container.querySelector('[data-settings-reset]')?.addEventListener('click', () => {
      this.settings = { ...defaultViewerSettings };
      this.syncForm();
      this.emitApply();
    });
    const qualityPreset = this.form.elements.namedItem('qualityPreset');
    if (qualityPreset instanceof HTMLSelectElement) qualityPreset.addEventListener('change', () => {
      const preset = qualityPreset.value;
      const maxInput = this.form.elements.namedItem('maxGaussians') as HTMLInputElement;
      if (preset === 'balanced') maxInput.value = String(DEFAULT_MAX_GAUSSIANS_BALANCED);
      if (preset === 'high') maxInput.value = String(DEFAULT_MAX_GAUSSIANS_HIGH);
      if (preset === 'full') maxInput.value = '0';
    });
    this.form.addEventListener('input', () => this.syncFromForm());
    this.form.addEventListener('change', () => this.syncFromForm());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.syncFromForm();
      this.close();
    });
  }

  private syncFromForm(): void {
    this.settings = this.readForm();
    this.syncOutputs();
    this.emitApply();
  }

  private emitApply(): void {
    const next = this.getSettings();
    this.applyCallbacks.forEach((callback) => callback(next));
  }

  private syncForm(): void {
    const s = this.settings;
    (this.form.elements.namedItem('qualityPreset') as HTMLSelectElement).value = s.qualityPreset;
    (this.form.elements.namedItem('maxGaussians') as HTMLInputElement).value = String(s.maxGaussians);
    (this.form.elements.namedItem('opacityThreshold') as HTMLInputElement).value = String(s.opacityThreshold);
    (this.form.elements.namedItem('focalPxOverride') as HTMLInputElement).value =
      s.focalPxOverride === null ? '' : String(s.focalPxOverride);
    (this.form.elements.namedItem('splatAlphaRemovalThreshold') as HTMLInputElement).value =
      String(s.splatAlphaRemovalThreshold);
    (this.form.elements.namedItem('splatScale') as HTMLInputElement).value = String(s.splatScale);
    (this.form.elements.namedItem('maxScreenSpaceSplatSize') as HTMLInputElement).value =
      String(s.maxScreenSpaceSplatSize);
    (this.form.elements.namedItem('pointCloudMode') as HTMLInputElement).checked = s.pointCloudMode;
    (this.form.elements.namedItem('backgroundColor') as HTMLInputElement).value = s.backgroundColor;
    (this.form.elements.namedItem('fov') as HTMLInputElement).value = String(s.fov);
    (this.form.elements.namedItem('externalApiUrl') as HTMLInputElement).value = s.externalApiUrl;
    this.syncOutputs();
  }

  private syncOutputs(): void {
    const pairs: Array<[string, string]> = [
      ['opacityThreshold', Number((this.form.elements.namedItem('opacityThreshold') as HTMLInputElement).value).toFixed(3)],
      ['splatScale', Number((this.form.elements.namedItem('splatScale') as HTMLInputElement).value).toFixed(2)],
      ['splatAlphaRemovalThreshold', (this.form.elements.namedItem('splatAlphaRemovalThreshold') as HTMLInputElement).value],
      ['fov', `${(this.form.elements.namedItem('fov') as HTMLInputElement).value}°`],
    ];
    pairs.forEach(([name, value]) => {
      const output = this.form.querySelector(`output[data-for="${name}"]`);
      if (output) output.textContent = value;
    });
  }

  private readForm(): ViewerSettings {
    const maxGaussians = Number((this.form.elements.namedItem('maxGaussians') as HTMLInputElement).value);
    const focalPxRaw = Number((this.form.elements.namedItem('focalPxOverride') as HTMLInputElement).value);
    return {
      qualityPreset: (this.form.elements.namedItem('qualityPreset') as HTMLSelectElement).value as ViewerSettings['qualityPreset'],
      maxGaussians: Number.isFinite(maxGaussians) ? Math.max(0, Math.floor(maxGaussians)) : DEFAULT_MAX_GAUSSIANS_HIGH,
      opacityThreshold: Number((this.form.elements.namedItem('opacityThreshold') as HTMLInputElement).value),
      focalPxOverride: Number.isFinite(focalPxRaw) && focalPxRaw > 0 ? focalPxRaw : null,
      splatAlphaRemovalThreshold: Number(
        (this.form.elements.namedItem('splatAlphaRemovalThreshold') as HTMLInputElement).value
      ),
      splatScale: Number((this.form.elements.namedItem('splatScale') as HTMLInputElement).value),
      maxScreenSpaceSplatSize: Number(
        (this.form.elements.namedItem('maxScreenSpaceSplatSize') as HTMLInputElement).value
      ),
      pointCloudMode: (this.form.elements.namedItem('pointCloudMode') as HTMLInputElement).checked,
      backgroundColor: (this.form.elements.namedItem('backgroundColor') as HTMLInputElement).value,
      fov: Number((this.form.elements.namedItem('fov') as HTMLInputElement).value),
      externalApiUrl: (this.form.elements.namedItem('externalApiUrl') as HTMLInputElement).value.trim(),
    };
  }
}
