// ============================================================
// renderer/ui/result.ts — 结果展示面板
// 显示外部 API 处理后的图片结果
// ============================================================

export class ResultUI {
  private container: HTMLElement;
  private comparisonContainer: HTMLElement;
  private originalImg: HTMLImageElement;
  private processedImg: HTMLImageElement;

  constructor() {
    this.container = this.createContainer();
    this.comparisonContainer = this.container.querySelector('#comparison-view')!;
    this.originalImg = this.container.querySelector('#result-original') as HTMLImageElement;
    this.processedImg = this.container.querySelector('#result-processed') as HTMLImageElement;
    this.mount();
  }

  private createContainer(): HTMLElement {
    const existing = document.getElementById('result-panel');
    if (existing) return existing;
    const el = document.createElement('div');
    el.id = 'result-panel';
    el.innerHTML = `
      <div class="result-header">
        <h3>处理结果</h3>
        <button id="result-close" class="result-close-btn">&times;</button>
      </div>
      <div id="comparison-view" class="comparison-view">
        <div class="comparison-side">
          <div class="comparison-label">原始截图</div>
          <img id="result-original" class="result-image" />
        </div>
        <div class="comparison-side">
          <div class="comparison-label">处理后</div>
          <img id="result-processed" class="result-image" />
        </div>
      </div>
    `;
    return el;
  }

  private mount(): void {
    const app = document.getElementById('app');
    if (app) app.appendChild(this.container);
    this.container.querySelector('#result-close')?.addEventListener('click', () => {
      this.clear();
    });
  }

  showResult(imageBlob: Blob): void {
    const url = URL.createObjectURL(imageBlob);
    this.processedImg.src = url;
    this.comparisonContainer.classList.add('single');
    this.container.style.display = '';
  }

  showComparison(original: Blob, processed: Blob): void {
    this.originalImg.src = URL.createObjectURL(original);
    this.processedImg.src = URL.createObjectURL(processed);
    this.comparisonContainer.classList.remove('single');
    this.container.style.display = '';
  }

  clear(): void {
    URL.revokeObjectURL(this.originalImg.src);
    URL.revokeObjectURL(this.processedImg.src);
    this.originalImg.src = '';
    this.processedImg.src = '';
    this.container.style.display = 'none';
  }
}