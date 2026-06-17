// ============================================================
// renderer/ui/viewer.ts — 3D 查看器容器
// 创建 3D 渲染的 DOM 容器，管理 Three.js 场景的生命周期
// ============================================================

import { SceneManager } from '../three/scene';
import { SplatLoader, type SplatCalibrationSettings } from '../three/splat-loader';
import { CameraController } from '../three/controls';
import { captureViewport } from '../three/capture';
import { fileAPI } from '../api/ipc';
import { appEvents } from '../state/events';
import { Events } from '../state/types';
import * as THREE from 'three';
import {
  DEFAULT_CAMERA_LOOK_AT,
  DEFAULT_CAMERA_POSITION,
  DEFAULT_CAMERA_UP,
  DEFAULT_MAX_SCREEN_SPACE_SPLAT_SIZE,
  DEFAULT_SPLAT_SCALE,
  DEFAULT_VIEWER_FOV,
} from '../../shared/constants';
import type { InferenceImageInfo, ViewerSettings } from '../../shared/types';

type RenderSettings = Pick<
  ViewerSettings,
  | 'splatAlphaRemovalThreshold'
  | 'splatScale'
  | 'maxScreenSpaceSplatSize'
  | 'pointCloudMode'
  | 'backgroundColor'
  | 'fov'
>;

interface CalibrationSettings extends SplatCalibrationSettings {
  referenceVisible: boolean;
  referenceOpacity: number;
  referenceScale: number;
  referenceOffsetX: number;
  referenceOffsetY: number;
  referenceRotation: number;
  referenceFitMode: 'contain' | 'cover' | 'stretch';
  cameraPositionX: number;
  cameraPositionY: number;
  cameraPositionZ: number;
  cameraTargetX: number;
  cameraTargetY: number;
  cameraTargetZ: number;
  cameraFov: number;
}

const AUTO_MODEL_SCALE_MIN = 0.01;
const AUTO_MODEL_SCALE_MAX = 100_000;
const AUTO_MODEL_TARGET_FILL = 0.98;
const MAX_AUTOFIT_SCALE_CORRECTION = 2;

export class ViewerUI {
  private container: HTMLElement;
  private sceneManager: SceneManager | null = null;
  private splatLoader: SplatLoader | null = null;
  private cameraController: CameraController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private disposeFrameCallback: (() => void) | null = null;
  private overlayImage: HTMLImageElement;
  private overlayPanel: HTMLElement;
  private calibrationSettings: CalibrationSettings = this.createDefaultCalibrationSettings();
  private sourceImage: InferenceImageInfo | null = null;
  private autoModelScale = 1;
  private autoFitReferenceSize: { width: number; height: number } | null = null;
  private autoModelOffsetCompensation = new THREE.Vector3();

  constructor() {
    this.container = this.createContainer();
    this.overlayImage = this.createOverlayImage();
    this.overlayPanel = this.createOverlayPanel();
    this.mount();
    this.bindEvents();
    this.syncCalibration();
  }

  private createContainer(): HTMLElement {
    const existing = document.getElementById('viewer-container');
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = 'viewer-container';
    return el;
  }

  private mount(): void {
    const app = document.getElementById('app');
    if (app) app.appendChild(this.container);
    this.container.appendChild(this.overlayImage);
    this.container.appendChild(this.overlayPanel);
  }

  private initScene(): void {
    if (this.sceneManager) return;

    this.sceneManager = new SceneManager(this.container);
    this.splatLoader = new SplatLoader(this.sceneManager);
    this.cameraController = new CameraController(
      this.sceneManager.getCamera(),
      this.sceneManager.getRenderer()
    );
    this.disposeFrameCallback = this.sceneManager.addFrameCallback(() => {
      this.cameraController?.update();
    });

    this.resizeObserver = new ResizeObserver(() => {
      const { width, height } = this.container.getBoundingClientRect();
      this.sceneManager?.resize(width, height);
    });
    this.resizeObserver.observe(this.container);
    this.applyCalibration();
  }

  async loadPly(plyPath: string, settings?: Partial<RenderSettings>): Promise<void> {
    this.container.classList.add('active');
    this.initScene();
    if (settings?.backgroundColor) this.sceneManager!.setBackground(settings.backgroundColor);
    if (settings?.fov) {
      this.sceneManager!.setFov(settings.fov);
      this.calibrationSettings.cameraFov = settings.fov;
    }
    this.syncRenderSettingsToCalibration(settings);
    await this.splatLoader!.load(plyPath, settings);
    const mesh = this.splatLoader!.getViewer();
    this.cameraController?.setRaycastTargets(mesh ? [mesh] : []);
    this.autoModelOffsetCompensation.set(0, 0, 0);
    this.updateAutoModelScale();
    this.applyCalibration();
  }

  async setReferenceImage(imagePath: string): Promise<void> {
    this.overlayImage.src = await this.resolveReferenceImageUrl(imagePath);
    this.calibrationSettings.referenceVisible = true;
    this.syncCalibration();
  }

  frameToImage(image: InferenceImageInfo): void {
    this.sourceImage = image;
    this.updateAutoModelScale();
    this.applyCalibration();
    this.syncCalibrationForm();
    this.syncCalibrationReport();
  }

  async updateSettings(settings: Partial<RenderSettings>): Promise<void> {
    this.initScene();
    if (settings.backgroundColor) this.sceneManager!.setBackground(settings.backgroundColor);
    if (settings.fov) {
      this.sceneManager!.setFov(settings.fov);
      this.calibrationSettings.cameraFov = settings.fov;
    }
    this.syncRenderSettingsToCalibration(settings);
    await this.splatLoader?.updateSettings(settings);
    this.splatLoader?.applyCalibration(this.toSplatCalibration(this.calibrationSettings));
    this.syncCalibrationForm();
    this.syncCalibrationReport();
  }

  resetCamera(): void {
    this.cameraController?.reset();
    const camera = this.cameraController?.getCalibration();
    if (camera) {
      this.calibrationSettings = { ...this.calibrationSettings, ...camera };
      this.syncCalibration();
    }
  }

  getContainer(): HTMLElement {
    return this.container;
  }

  getSceneManager(): SceneManager | null {
    return this.sceneManager;
  }

  getSplatLoader(): SplatLoader | null {
    return this.splatLoader;
  }

  async capture(): Promise<Blob> {
    if (!this.sceneManager) {
      throw new Error('场景未初始化');
    }
    return captureViewport(this.sceneManager.getRenderer());
  }

  private bindEvents(): void {
    appEvents.on(Events.CAPTURE_REQUESTED, async () => {
      try {
        const blob = await this.capture();
        appEvents.emit(Events.CAPTURE_COMPLETE, blob);
      } catch (err) {
        appEvents.emit(Events.APP_ERROR, {
          code: 'FILE_WRITE_ERROR',
          message: '截图失败',
          detail: String(err),
        });
      }
    });
  }

  private createOverlayImage(): HTMLImageElement {
    const img = document.createElement('img');
    img.className = 'reference-overlay-image';
    img.alt = '';
    img.addEventListener('load', () => {
      this.syncCalibrationReport();
    });
    img.addEventListener('error', () => {
      console.error('参考图加载失败:', img.src);
      this.syncCalibrationReport();
    });
    return img;
  }

  private async resolveReferenceImageUrl(imagePathOrUrl: string): Promise<string> {
    if (/^(sharp-viewer|blob|data):/.test(imagePathOrUrl)) {
      return imagePathOrUrl;
    }

    try {
      const registerLocalFile = window.electronAPI?.registerLocalFile;
      if (typeof registerLocalFile === 'function') {
        return await fileAPI.registerLocalFile(imagePathOrUrl);
      }
    } catch (error) {
      console.warn('参考图注册失败，无法使用本地路径叠加', error);
    }

    return this.toFileUrl(imagePathOrUrl);
  }

  private toFileUrl(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const encoded = normalized.split('/').map((part, index) => {
      if (index === 0 && /^[A-Za-z]:$/.test(part)) return part;
      return encodeURIComponent(part);
    }).join('/');
    return `file:///${encoded.replace(/^\/+/, '')}`;
  }

  private createOverlayPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'reference-overlay-panel';
    panel.innerHTML = `
      <button type="button" class="reference-overlay-toggle" data-calibration-toggle>校准</button>
      <div class="reference-overlay-controls" data-calibration-controls>
        <section>
          <h3>参考图</h3>
          <label class="reference-overlay-check">
            <input name="referenceVisible" type="checkbox" />
            <span>显示叠加</span>
          </label>
          ${this.rangeControl('referenceOpacity', '透明度', 0, 1, 0.01)}
          ${this.rangeControl('referenceScale', '缩放', 0.05, 50, 0.01)}
          ${this.rangeControl('referenceOffsetX', '水平位移', -200, 200, 0.1)}
          ${this.rangeControl('referenceOffsetY', '垂直位移', -200, 200, 0.1)}
          ${this.rangeControl('referenceRotation', '旋转', -180, 180, 0.1)}
          <label>
            <span>适配</span>
            <select name="referenceFitMode">
              <option value="contain">Contain</option>
              <option value="cover">Cover</option>
              <option value="stretch">Stretch</option>
            </select>
          </label>
        </section>

        <section>
          <h3>相机</h3>
          ${this.numberControl('cameraPositionX', '位置 X', 0.01)}
          ${this.numberControl('cameraPositionY', '位置 Y', 0.01)}
          ${this.numberControl('cameraPositionZ', '位置 Z', 0.01)}
          ${this.numberControl('cameraTargetX', '目标 X', 0.01)}
          ${this.numberControl('cameraTargetY', '目标 Y', 0.01)}
          ${this.numberControl('cameraTargetZ', '目标 Z', 0.01)}
          ${this.rangeControl('cameraFov', 'FOV', 10, 120, 0.1)}
          <button type="button" data-read-camera>读取当前视角</button>
        </section>

        <section>
          <h3>模型</h3>
          ${this.rangeControl('modelScale', '模型缩放', AUTO_MODEL_SCALE_MIN, AUTO_MODEL_SCALE_MAX, 0.01)}
          ${this.numberControl('modelOffsetX', '模型 X', 0.01)}
          ${this.numberControl('modelOffsetY', '模型 Y', 0.01)}
          ${this.numberControl('modelOffsetZ', '模型 Z', 0.01)}
          ${this.rangeControl('modelRotationX', '旋转 X', -360, 360, 0.1)}
          ${this.rangeControl('modelRotationY', '旋转 Y', -360, 360, 0.1)}
          ${this.rangeControl('modelRotationZ', '旋转 Z', -360, 360, 0.1)}
          ${this.rangeControl('splatOpacity', '不透明度', 0, 1, 0.01)}
          ${this.rangeControl('maxSh', 'SH 阶数', 0, 3, 1)}
        </section>

        <section>
          <h3>Spark 渲染</h3>
          ${this.rangeControl('maxPixelRadius', '最大半径', 1, 2048, 1)}
          ${this.rangeControl('minPixelRadius', '最小半径', 0, 32, 0.25)}
          ${this.rangeControl('minAlpha', 'Alpha 剔除', 0, 0.1, 0.0001)}
          ${this.rangeControl('falloff', 'Falloff', 0.1, 4, 0.01)}
          ${this.rangeControl('focalAdjustment', '焦距修正', 0.25, 4, 0.01)}
        </section>

        <section>
          <h3>复制给我</h3>
          <textarea data-calibration-json readonly spellcheck="false"></textarea>
          <button type="button" data-copy-calibration>复制参数</button>
          <button type="button" data-calibration-reset>重置</button>
        </section>
      </div>
    `;

    panel.querySelector('[data-calibration-toggle]')?.addEventListener('click', () => {
      panel.classList.toggle('open');
      this.syncCalibration();
    });
    panel.querySelector('[data-calibration-reset]')?.addEventListener('click', () => {
      this.calibrationSettings = this.createDefaultCalibrationSettings();
      this.calibrationSettings.referenceVisible = Boolean(this.overlayImage.src);
      this.autoModelOffsetCompensation.set(0, 0, 0);
      this.syncCalibration();
    });
    panel.querySelector('[data-read-camera]')?.addEventListener('click', () => {
      const camera = this.cameraController?.getCalibration();
      if (!camera) return;
      this.calibrationSettings = { ...this.calibrationSettings, ...camera };
      this.syncCalibration();
    });
    panel.querySelector('[data-copy-calibration]')?.addEventListener('click', async () => {
      const output = panel.querySelector<HTMLTextAreaElement>('[data-calibration-json]');
      const copyButton = panel.querySelector<HTMLButtonElement>('[data-copy-calibration]');
      if (!output?.value) return;
      try {
        await navigator.clipboard.writeText(output.value);
      } catch {
        output.focus();
        output.select();
        document.execCommand('copy');
      }
      if (copyButton) {
        copyButton.textContent = '已复制';
        window.setTimeout(() => {
          copyButton.textContent = '复制参数';
        }, 1200);
      }
    });
    panel.addEventListener('input', (event) => {
      this.syncPairedInput(event.target);
      this.calibrationSettings = this.readCalibrationForm();
      this.syncCalibration();
    });
    panel.addEventListener('change', (event) => {
      this.syncPairedInput(event.target);
      this.calibrationSettings = this.readCalibrationForm();
      this.syncCalibration();
    });
    return panel;
  }

  private rangeControl(name: keyof CalibrationSettings, label: string, min: number, max: number, step: number): string {
    return `
      <label>
        <span>${label}</span>
        <input name="${name}" type="range" min="${min}" max="${max}" step="${step}" />
        <input name="${name}Value" data-value-for="${name}" type="number" min="${min}" max="${max}" step="${step}" />
      </label>
    `;
  }

  private numberControl(name: keyof CalibrationSettings, label: string, step: number): string {
    return `
      <label>
        <span>${label}</span>
        <input class="calibration-number-only" name="${name}" type="number" step="${step}" />
      </label>
    `;
  }

  private syncPairedInput(target: EventTarget | null): void {
    if (!(target instanceof HTMLInputElement)) return;
    const valueFor = target.dataset.valueFor;
    const rangeName = target.name as keyof CalibrationSettings;
    if (valueFor) {
      const range = this.overlayPanel.querySelector<HTMLInputElement>(`input[name="${valueFor}"]`);
      if (range) range.value = target.value;
      return;
    }

    if (target.type === 'range') {
      const number = this.overlayPanel.querySelector<HTMLInputElement>(`input[data-value-for="${rangeName}"]`);
      if (number) number.value = target.value;
    }
  }

  private readCalibrationForm(): CalibrationSettings {
    const defaults = this.calibrationSettings;
    const readNumber = (name: keyof CalibrationSettings, fallback: number): number => {
      const input =
        this.overlayPanel.querySelector<HTMLInputElement>(`input[data-value-for="${name}"]`) ??
        this.overlayPanel.querySelector<HTMLInputElement>(`input[name="${name}"]`);
      const value = Number(input?.value);
      return Number.isFinite(value) ? value : fallback;
    };
    const referenceVisible = this.overlayPanel.querySelector<HTMLInputElement>('input[name="referenceVisible"]');
    const referenceFitMode = this.overlayPanel.querySelector<HTMLSelectElement>('select[name="referenceFitMode"]');
    return {
      referenceVisible: Boolean(referenceVisible?.checked),
      referenceOpacity: readNumber('referenceOpacity', defaults.referenceOpacity),
      referenceScale: readNumber('referenceScale', defaults.referenceScale),
      referenceOffsetX: readNumber('referenceOffsetX', defaults.referenceOffsetX),
      referenceOffsetY: readNumber('referenceOffsetY', defaults.referenceOffsetY),
      referenceRotation: readNumber('referenceRotation', defaults.referenceRotation),
      referenceFitMode: (referenceFitMode?.value as CalibrationSettings['referenceFitMode']) ?? defaults.referenceFitMode,
      cameraPositionX: readNumber('cameraPositionX', defaults.cameraPositionX),
      cameraPositionY: readNumber('cameraPositionY', defaults.cameraPositionY),
      cameraPositionZ: readNumber('cameraPositionZ', defaults.cameraPositionZ),
      cameraTargetX: readNumber('cameraTargetX', defaults.cameraTargetX),
      cameraTargetY: readNumber('cameraTargetY', defaults.cameraTargetY),
      cameraTargetZ: readNumber('cameraTargetZ', defaults.cameraTargetZ),
      cameraFov: readNumber('cameraFov', defaults.cameraFov),
      modelScale: readNumber('modelScale', defaults.modelScale),
      modelOffsetX: readNumber('modelOffsetX', defaults.modelOffsetX),
      modelOffsetY: readNumber('modelOffsetY', defaults.modelOffsetY),
      modelOffsetZ: readNumber('modelOffsetZ', defaults.modelOffsetZ),
      modelRotationX: readNumber('modelRotationX', defaults.modelRotationX),
      modelRotationY: readNumber('modelRotationY', defaults.modelRotationY),
      modelRotationZ: readNumber('modelRotationZ', defaults.modelRotationZ),
      splatOpacity: readNumber('splatOpacity', defaults.splatOpacity),
      maxSh: readNumber('maxSh', defaults.maxSh),
      maxPixelRadius: readNumber('maxPixelRadius', defaults.maxPixelRadius),
      minPixelRadius: readNumber('minPixelRadius', defaults.minPixelRadius),
      minAlpha: readNumber('minAlpha', defaults.minAlpha),
      falloff: readNumber('falloff', defaults.falloff),
      focalAdjustment: readNumber('focalAdjustment', defaults.focalAdjustment),
    };
  }

  private syncCalibration(): void {
    const s = this.calibrationSettings;
    this.overlayImage.style.display = s.referenceVisible && this.overlayImage.src ? 'block' : 'none';
    this.overlayImage.style.opacity = String(s.referenceOpacity);
    this.overlayImage.style.objectFit = s.referenceFitMode === 'stretch' ? 'fill' : s.referenceFitMode;
    this.overlayImage.style.transform =
      `translate(calc(-50% + ${s.referenceOffsetX}vw), calc(-50% + ${s.referenceOffsetY}vh)) rotate(${s.referenceRotation}deg) scale(${s.referenceScale})`;

    this.applyCalibration();
    this.syncCalibrationForm();
    this.syncCalibrationReport();
  }

  private syncRenderSettingsToCalibration(settings?: Partial<RenderSettings>): void {
    if (!settings) return;
    if (typeof settings.splatScale === 'number') {
      this.calibrationSettings.modelScale = settings.splatScale;
    }
    if (typeof settings.maxScreenSpaceSplatSize === 'number') {
      this.calibrationSettings.maxPixelRadius = settings.maxScreenSpaceSplatSize;
    }
    if (typeof settings.splatAlphaRemovalThreshold === 'number') {
      this.calibrationSettings.minAlpha = Math.max(0.5 / 255, settings.splatAlphaRemovalThreshold / 255);
    }
    if (typeof settings.pointCloudMode === 'boolean') {
      this.calibrationSettings.minPixelRadius = settings.pointCloudMode ? 1.25 : 0;
      this.calibrationSettings.maxPixelRadius = settings.pointCloudMode
        ? 1.5
        : (settings.maxScreenSpaceSplatSize ?? this.calibrationSettings.maxPixelRadius);
      this.calibrationSettings.splatOpacity = settings.pointCloudMode ? 0.8 : 1;
    }
  }

  private updateAutoModelScale(): void {
    const image = this.sourceImage;
    const samples = this.splatLoader?.getPositionSamples();
    const scene = this.sceneManager;
    if (!image || !samples || !scene) return;

    const viewport = this.container.getBoundingClientRect();
    if (viewport.width <= 0 || viewport.height <= 0) return;

    const camera = scene.getCamera().clone();
    camera.position.set(
      this.calibrationSettings.cameraPositionX,
      this.calibrationSettings.cameraPositionY,
      this.calibrationSettings.cameraPositionZ
    );
    camera.up.set(...DEFAULT_CAMERA_UP);
    camera.lookAt(
      this.calibrationSettings.cameraTargetX,
      this.calibrationSettings.cameraTargetY,
      this.calibrationSettings.cameraTargetZ
    );
    this.calibrationSettings.cameraFov = this.computeContainPhotoFov(image, viewport.width, viewport.height);
    camera.fov = this.calibrationSettings.cameraFov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    const reference = this.getReferenceImageContainSize(image, viewport.width, viewport.height);
    if (reference.width <= 0 || reference.height <= 0) return;
    this.autoFitReferenceSize = reference;

    const baseOffset = new THREE.Vector3(0, 0, 0);
    this.autoModelOffsetCompensation.set(0, 0, 0);
    const expected = this.measureProjectedSamples(samples, camera, viewport.width, viewport.height, 1, baseOffset);
    if (expected) {
      const ratio = Math.max(expected.width / reference.width, expected.height / reference.height);
      if (Number.isFinite(ratio) && ratio > 0.5 && ratio < 1.5) {
        this.autoModelScale = 1;
        this.calibrationSettings.modelScale = 1;
        this.calibrationSettings.modelOffsetX = 0;
        this.calibrationSettings.modelOffsetY = 0;
        this.calibrationSettings.modelOffsetZ = 0;
        return;
      }
    }

    const fit = this.solveModelScaleForReference(
      samples,
      camera,
      reference,
      viewport.width,
      viewport.height,
      baseOffset
    );
    if (!fit || !Number.isFinite(fit.scale)) return;

    const correctedScale = this.clampFinite(
      fit.scale,
      1 / MAX_AUTOFIT_SCALE_CORRECTION,
      MAX_AUTOFIT_SCALE_CORRECTION
    );
    this.autoModelScale = correctedScale;
    this.calibrationSettings.modelScale = correctedScale;
    this.calibrationSettings.modelOffsetX = 0;
    this.calibrationSettings.modelOffsetY = 0;
    this.calibrationSettings.modelOffsetZ = 0;
  }

  private solveModelScaleForReference(
    samples: Float32Array,
    camera: THREE.PerspectiveCamera,
    reference: { width: number; height: number },
    viewportWidth: number,
    viewportHeight: number,
    baseOffset: THREE.Vector3,
  ): { scale: number; offset: THREE.Vector3 } | null {
    const localCenter = this.computeSampleCenter(samples);
    const scoreScale = (scale: number): { scale: number; offset: THREE.Vector3; score: number; ratio: number } | null => {
      const offset = this.computeDepthCompensatedOffset(camera, localCenter, scale, baseOffset);
      const projected = this.measureProjectedSamples(samples, camera, viewportWidth, viewportHeight, scale, offset);
      if (!projected) return null;
      const ratio = Math.max(projected.width / reference.width, projected.height / reference.height);
      if (!Number.isFinite(ratio) || ratio <= 0) return null;
      return {
        scale,
        offset,
        ratio,
        score: Math.abs(Math.log(ratio / AUTO_MODEL_TARGET_FILL)),
      };
    };

    let best: { scale: number; offset: THREE.Vector3; score: number; ratio: number } | null = null;
    const steps = 96;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const scale = AUTO_MODEL_SCALE_MIN * Math.pow(AUTO_MODEL_SCALE_MAX / AUTO_MODEL_SCALE_MIN, t);
      const scored = scoreScale(scale);
      if (scored && (!best || scored.score < best.score)) best = scored;
    }
    if (!best) return null;

    let lo = Math.max(AUTO_MODEL_SCALE_MIN, best.scale / 1.5);
    let hi = Math.min(AUTO_MODEL_SCALE_MAX, best.scale * 1.5);
    for (let i = 0; i < 20; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      const s1 = scoreScale(m1);
      const s2 = scoreScale(m2);
      if (!s1 && !s2) break;
      if (!s2 || (s1 && s1.score < s2.score)) {
        hi = m2;
        if (s1 && s1.score < best.score) best = s1;
      } else {
        lo = m1;
        if (s2.score < best.score) best = s2;
      }
    }

    return {
      scale: this.clampFinite(best.scale, AUTO_MODEL_SCALE_MIN, AUTO_MODEL_SCALE_MAX),
      offset: best.offset,
    };
  }

  private measureProjectedSamples(
    samples: Float32Array,
    camera: THREE.PerspectiveCamera,
    viewportWidth: number,
    viewportHeight: number,
    scale: number,
    offset: THREE.Vector3,
  ): { width: number; height: number } | null {
    const rotation = new THREE.Euler(
      THREE.MathUtils.degToRad(this.calibrationSettings.modelRotationX),
      THREE.MathUtils.degToRad(this.calibrationSettings.modelRotationY),
      THREE.MathUtils.degToRad(this.calibrationSettings.modelRotationZ)
    );
    const matrix = new THREE.Matrix4().compose(
      offset,
      new THREE.Quaternion().setFromEuler(rotation),
      new THREE.Vector3(scale, scale, scale)
    );
    const point = new THREE.Vector3();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;

    for (let i = 0; i < samples.length; i += 3) {
      point.set(samples[i], samples[i + 1], samples[i + 2]).applyMatrix4(matrix).project(camera);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) continue;
      if (point.z < -1 || point.z > 1) continue;
      const x = (point.x * 0.5 + 0.5) * viewportWidth;
      const y = (-point.y * 0.5 + 0.5) * viewportHeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count++;
    }

    const sampleCount = samples.length / 3;
    if (count < Math.max(50, sampleCount * 0.05) || !Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return {
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  private computeSampleCenter(samples: Float32Array): THREE.Vector3 {
    const center = new THREE.Vector3();
    const count = samples.length / 3;
    if (!count) return center;
    for (let i = 0; i < samples.length; i += 3) {
      center.x += samples[i];
      center.y += samples[i + 1];
      center.z += samples[i + 2];
    }
    return center.multiplyScalar(1 / count);
  }

  private computeDepthCompensatedOffset(
    camera: THREE.PerspectiveCamera,
    localCenter: THREE.Vector3,
    scale: number,
    baseOffset: THREE.Vector3,
  ): THREE.Vector3 {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(this.calibrationSettings.modelRotationX),
      THREE.MathUtils.degToRad(this.calibrationSettings.modelRotationY),
      THREE.MathUtils.degToRad(this.calibrationSettings.modelRotationZ)
    ));
    const baseCenter = localCenter.clone().applyQuaternion(rotation).add(baseOffset);
    const scaledCenter = localCenter.clone().multiplyScalar(scale).applyQuaternion(rotation).add(baseOffset);
    const baseDepth = baseCenter.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const scaledDepth = scaledCenter.clone().applyMatrix4(camera.matrixWorldInverse).z;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    return baseOffset.clone().addScaledVector(forward, scaledDepth - baseDepth);
  }

  private getReferenceImageContainSize(
    image: InferenceImageInfo,
    viewportWidth: number,
    viewportHeight: number,
  ): { width: number; height: number } {
    const scale = Math.min(viewportWidth / image.width, viewportHeight / image.height);
    return {
      width: image.width * scale,
      height: image.height * scale,
    };
  }

  private computeContainPhotoFov(
    image: InferenceImageInfo,
    viewportWidth: number,
    viewportHeight: number,
  ): number {
    const imageAspect = image.width / image.height;
    const viewportAspect = viewportWidth / viewportHeight;
    let verticalFov = 2 * Math.atan(image.height / (2 * image.focalPx));
    if (viewportAspect < imageAspect) {
      const horizontalFov = 2 * Math.atan(image.width / (2 * image.focalPx));
      verticalFov = 2 * Math.atan(Math.tan(horizontalFov / 2) / viewportAspect);
    }
    return this.clampFinite(THREE.MathUtils.radToDeg(verticalFov), 1, 120);
  }

  private clampFinite(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }

  private applyCalibration(): void {
    const s = this.calibrationSettings;
    this.cameraController?.applyCalibration({
      cameraPositionX: s.cameraPositionX,
      cameraPositionY: s.cameraPositionY,
      cameraPositionZ: s.cameraPositionZ,
      cameraTargetX: s.cameraTargetX,
      cameraTargetY: s.cameraTargetY,
      cameraTargetZ: s.cameraTargetZ,
      cameraFov: s.cameraFov,
    });
    this.splatLoader?.applyCalibration(this.toSplatCalibration(s));
  }

  private toSplatCalibration(settings: CalibrationSettings): SplatCalibrationSettings {
    return {
      modelScale: settings.modelScale,
      modelOffsetX: settings.modelOffsetX,
      modelOffsetY: settings.modelOffsetY,
      modelOffsetZ: settings.modelOffsetZ,
      modelRotationX: settings.modelRotationX,
      modelRotationY: settings.modelRotationY,
      modelRotationZ: settings.modelRotationZ,
      splatOpacity: settings.splatOpacity,
      maxSh: settings.maxSh,
      maxPixelRadius: settings.maxPixelRadius,
      minPixelRadius: settings.minPixelRadius,
      minAlpha: settings.minAlpha,
      falloff: settings.falloff,
      focalAdjustment: settings.focalAdjustment,
    };
  }

  private syncCalibrationForm(): void {
    const s = this.calibrationSettings;
    const setInput = (name: keyof CalibrationSettings, value: number): void => {
      const inputs = this.overlayPanel.querySelectorAll<HTMLInputElement>(
        `input[name="${name}"], input[data-value-for="${name}"]`
      );
      inputs.forEach((input) => {
        if (document.activeElement !== input) input.value = String(value);
      });
    };
    const referenceVisible = this.overlayPanel.querySelector<HTMLInputElement>('input[name="referenceVisible"]');
    const referenceFitMode = this.overlayPanel.querySelector<HTMLSelectElement>('select[name="referenceFitMode"]');
    if (referenceVisible) referenceVisible.checked = s.referenceVisible;
    if (referenceFitMode) referenceFitMode.value = s.referenceFitMode;

    setInput('referenceOpacity', s.referenceOpacity);
    setInput('referenceScale', s.referenceScale);
    setInput('referenceOffsetX', s.referenceOffsetX);
    setInput('referenceOffsetY', s.referenceOffsetY);
    setInput('referenceRotation', s.referenceRotation);
    setInput('cameraPositionX', s.cameraPositionX);
    setInput('cameraPositionY', s.cameraPositionY);
    setInput('cameraPositionZ', s.cameraPositionZ);
    setInput('cameraTargetX', s.cameraTargetX);
    setInput('cameraTargetY', s.cameraTargetY);
    setInput('cameraTargetZ', s.cameraTargetZ);
    setInput('cameraFov', s.cameraFov);
    setInput('modelScale', s.modelScale);
    setInput('modelOffsetX', s.modelOffsetX);
    setInput('modelOffsetY', s.modelOffsetY);
    setInput('modelOffsetZ', s.modelOffsetZ);
    setInput('modelRotationX', s.modelRotationX);
    setInput('modelRotationY', s.modelRotationY);
    setInput('modelRotationZ', s.modelRotationZ);
    setInput('splatOpacity', s.splatOpacity);
    setInput('maxSh', s.maxSh);
    setInput('maxPixelRadius', s.maxPixelRadius);
    setInput('minPixelRadius', s.minPixelRadius);
    setInput('minAlpha', s.minAlpha);
    setInput('falloff', s.falloff);
    setInput('focalAdjustment', s.focalAdjustment);

  }

  private syncCalibrationReport(): void {
    const output = this.overlayPanel.querySelector<HTMLTextAreaElement>('[data-calibration-json]');
    if (!output) return;
    output.value = JSON.stringify(this.buildCalibrationReport(), null, 2);
  }

  private buildCalibrationReport(): object {
    const s = this.calibrationSettings;
    const bounds = this.container.getBoundingClientRect();
    return {
      sharpViewerCalibrationVersion: 1,
      viewport: {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        devicePixelRatio: window.devicePixelRatio,
      },
      referenceImage: {
        loaded: Boolean(this.overlayImage.src),
        complete: this.overlayImage.complete,
        naturalWidth: this.overlayImage.naturalWidth || null,
        naturalHeight: this.overlayImage.naturalHeight || null,
        currentSrc: this.overlayImage.currentSrc || this.overlayImage.src || null,
      },
      autoFit: {
        modelScale: this.autoModelScale,
        modelOffsetCompensation: [
          this.autoModelOffsetCompensation.x,
          this.autoModelOffsetCompensation.y,
          this.autoModelOffsetCompensation.z,
        ],
        referenceSize: this.autoFitReferenceSize,
        sourceImage: this.sourceImage,
      },
      overlay: {
        visible: s.referenceVisible,
        opacity: s.referenceOpacity,
        scale: s.referenceScale,
        offsetVw: [s.referenceOffsetX, s.referenceOffsetY],
        rotationDeg: s.referenceRotation,
        fitMode: s.referenceFitMode,
      },
      camera: {
        position: [s.cameraPositionX, s.cameraPositionY, s.cameraPositionZ],
        target: [s.cameraTargetX, s.cameraTargetY, s.cameraTargetZ],
        fov: s.cameraFov,
      },
      model: {
        scale: s.modelScale,
        offset: [s.modelOffsetX, s.modelOffsetY, s.modelOffsetZ],
        rotationDeg: [s.modelRotationX, s.modelRotationY, s.modelRotationZ],
        opacity: s.splatOpacity,
        maxSh: s.maxSh,
      },
      spark: {
        maxPixelRadius: s.maxPixelRadius,
        minPixelRadius: s.minPixelRadius,
        minAlpha: s.minAlpha,
        falloff: s.falloff,
        focalAdjustment: s.focalAdjustment,
      },
    };
  }

  private createDefaultCalibrationSettings(): CalibrationSettings {
    return {
      referenceVisible: false,
      referenceOpacity: 0.45,
      referenceScale: 1,
      referenceOffsetX: 0,
      referenceOffsetY: 0,
      referenceRotation: 0,
      referenceFitMode: 'contain',
      cameraPositionX: DEFAULT_CAMERA_POSITION[0],
      cameraPositionY: DEFAULT_CAMERA_POSITION[1],
      cameraPositionZ: DEFAULT_CAMERA_POSITION[2],
      cameraTargetX: DEFAULT_CAMERA_LOOK_AT[0],
      cameraTargetY: DEFAULT_CAMERA_LOOK_AT[1],
      cameraTargetZ: DEFAULT_CAMERA_LOOK_AT[2],
      cameraFov: DEFAULT_VIEWER_FOV,
      modelScale: DEFAULT_SPLAT_SCALE,
      modelOffsetX: 0,
      modelOffsetY: 0,
      modelOffsetZ: 0,
      modelRotationX: 180,
      modelRotationY: 0,
      modelRotationZ: 0,
      splatOpacity: 1,
      maxSh: 3,
      maxPixelRadius: DEFAULT_MAX_SCREEN_SPACE_SPLAT_SIZE,
      minPixelRadius: 0,
      minAlpha: 0.5 / 255,
      falloff: 1,
      focalAdjustment: 1,
    };
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.disposeFrameCallback?.();
    this.splatLoader?.unload();
    this.sceneManager?.dispose();
    this.cameraController?.dispose();
    this.sceneManager = null;
    this.splatLoader = null;
    this.cameraController = null;
  }
}
