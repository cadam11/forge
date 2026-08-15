import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { renderMarkdown, sanitizeDiagramSvg } from './markdown-renderer';

/** How many diagrams one message may render. Model output is not a trusted bound. */
const MAX_DIAGRAMS_PER_MESSAGE = 20;

export type MermaidTheme = 'default' | 'base' | 'dark' | 'forest' | 'neutral';

/** The subset of mermaid's API this component uses. */
type MermaidApi = {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ svg: string }>;
};

let mermaidModule: MermaidApi | null = null;

/**
 * Loaded on first use rather than imported statically. Mermaid is ~190KB and most
 * assistant messages contain no diagram; the renderer bundle is already over its
 * budget, so putting it in the initial chunk would be a straight regression. The
 * app already lazy-loads its feature routes the same way.
 *
 * `securityLevel: 'strict'` is the other point of this function. The renderer this
 * replaces used `'loose'`, which permits click handlers and raw HTML labels inside
 * diagrams whose source is model-authored.
 */
async function loadMermaid(theme: MermaidTheme): Promise<MermaidApi> {
  if (mermaidModule) {
    return mermaidModule;
  }
  const { default: mermaid } = await import('mermaid');
  const api = mermaid as unknown as MermaidApi;
  api.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    fontFamily: 'inherit',
    suppressErrorRendering: true,
  });
  mermaidModule = api;
  return api;
}

/**
 * Adds a copy button to every code block, working on a detached <template> so the
 * live DOM is never touched. Input is already DOMPurify output; assigning it to an
 * inert template neither executes script nor fetches subresources.
 */
function addCopyButtons(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const pre of Array.from(template.content.querySelectorAll('pre'))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy-btn';
    button.textContent = 'Copy';
    pre.appendChild(button);
  }
  return template.innerHTML;
}

/**
 * Renders model-authored markdown.
 *
 * The parse-and-sanitize step lives in `markdown-renderer.ts`; this component owns
 * only the Angular wiring, the copy affordance, and mermaid. Inputs mirror the
 * component it replaces so call sites are a tag rename.
 */
@Component({
  selector: 'app-markdown',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="markdown-container"
      [ngClass]="containerClass"
      [innerHTML]="safeHtml()"
      (click)="onContainerClick($event)"
    ></div>
    @if (copyError() || diagramError()) {
      <p class="markdown-copy-error" role="alert">{{ copyError() || diagramError() }}</p>
    }
  `,
  styles: [
    `
      .markdown-container {
        position: relative;
      }

      .markdown-copy-error {
        margin: 4px 0 0;
        color: var(--status-error);
        font-size: var(--font-size-sm, 12px);
      }
    `,
  ],
})
export class MarkdownViewerComponent implements AfterViewChecked {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly _data = signal('');
  private readonly _enableMermaid = signal(false);
  private readonly _enableCodeCopy = signal(false);
  private readonly _copyError = signal('');
  private readonly _diagramError = signal('');

  /** Guards the mermaid pass so ngAfterViewChecked only acts on new content. */
  private lastDiagramSource = '';

  @Input()
  set data(value: string) {
    this._data.set(value ?? '');
  }
  get data(): string {
    return this._data();
  }

  @Input()
  set enableMermaid(value: boolean) {
    this._enableMermaid.set(value);
  }
  get enableMermaid(): boolean {
    return this._enableMermaid();
  }

  @Input()
  set enableCodeCopy(value: boolean) {
    this._enableCodeCopy.set(value);
  }
  get enableCodeCopy(): boolean {
    return this._enableCodeCopy();
  }

  @Input() containerClass = '';
  @Input() mermaidTheme: MermaidTheme = 'dark';

  /** Sanitized HTML as a plain string. The unit-testable seam. */
  readonly renderedHtml = computed(() => {
    const html = renderMarkdown(this._data());
    if (html === '' || !this._enableCodeCopy()) {
      return html;
    }
    return addCopyButtons(html);
  });

  /**
   * Trusted only because `renderedHtml` is DOMPurify output. Angular's own
   * sanitizer is not a viable substitute here: its element allowlist has no
   * `input`, so it would silently drop GFM task-list checkboxes.
   *
   * Being a computed over a signal is what keeps streaming alive under OnPush —
   * the equivalent imperative implementation has to remember markForCheck().
   */
  readonly safeHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.renderedHtml())
  );

  readonly copyError = this._copyError.asReadonly();
  readonly diagramError = this._diagramError.asReadonly();

  /**
   * Mermaid renders against the live DOM, so it can only run once the innerHTML
   * binding has been applied. The source guard keeps this to one pass per distinct
   * message rather than one per change-detection cycle.
   */
  ngAfterViewChecked(): void {
    if (!this._enableMermaid()) {
      return;
    }
    const html = this.renderedHtml();
    if (html === this.lastDiagramSource) {
      return;
    }
    this.lastDiagramSource = html;
    this.renderDiagrams().catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      this._diagramError.set(`Diagram rendering failed: ${reason}`);
    });
  }

  /**
   * Delegated click handler. Delegation rather than post-render listener injection
   * means there is nothing to unbind on destroy.
   */
  async onContainerClick(event: MouseEvent): Promise<void> {
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.('.code-copy-btn');
    if (!button) {
      return;
    }

    const code = button.closest('pre')?.querySelector('code')?.textContent ?? '';
    this._copyError.set('');
    try {
      await navigator.clipboard.writeText(code);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this._copyError.set(`Copy failed: ${reason}`);
    }
  }

  /**
   * Replaces mermaid code blocks with rendered SVG.
   *
   * Unavoidably imperative — mermaid renders against a live document. Called from
   * the host component after the innerHTML binding has settled.
   */
  async renderDiagrams(): Promise<void> {
    if (!this._enableMermaid()) {
      return;
    }

    const root = this.host.nativeElement as HTMLElement;
    const blocks = Array.from(
      root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')
    ).slice(0, MAX_DIAGRAMS_PER_MESSAGE);
    if (blocks.length === 0) {
      return;
    }

    const mermaid = await loadMermaid(this.mermaidTheme);

    for (const [index, block] of blocks.entries()) {
      const pre = block.parentElement;
      if (!pre) {
        continue;
      }
      const container = document.createElement('div');
      try {
        const { svg } = await mermaid.render(
          `diagram-${index}-${Date.now()}`,
          block.textContent ?? ''
        );
        container.className = 'mermaid-diagram';
        container.innerHTML = sanitizeDiagramSvg(svg);
      } catch (error) {
        // A malformed diagram must degrade to readable source, not blank space.
        container.className = 'mermaid-error';
        container.textContent = block.textContent ?? '';
        const reason = error instanceof Error ? error.message : String(error);
        this._diagramError.set(`Diagram failed to render: ${reason}`);
      }
      pre.replaceWith(container);
    }
  }
}
