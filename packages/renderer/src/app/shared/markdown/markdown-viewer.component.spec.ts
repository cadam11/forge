// @vitest-environment jsdom
import '@angular/compiler';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElementRef, Injector, runInInjectionContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MarkdownViewerComponent } from './markdown-viewer.component';

/**
 * Class-level tests — no TestBed, matching the other specs in this package. The
 * one behaviour these cannot reach is the OnPush + streaming wiring, which
 * `tests/e2e/chat-markdown.spec.ts` covers.
 */

function makeComponent(): MarkdownViewerComponent {
  const injector = Injector.create({
    providers: [
      {
        provide: DomSanitizer,
        // Identity pass-through: these tests assert on the sanitized string the
        // component produces, not on Angular's SafeHtml wrapper.
        useValue: { bypassSecurityTrustHtml: (value: string) => value },
      },
      { provide: ElementRef, useValue: new ElementRef(document.createElement('div')) },
    ],
  });
  return runInInjectionContext(injector, () => new MarkdownViewerComponent());
}

describe('MarkdownViewerComponent', () => {
  let component: MarkdownViewerComponent;

  beforeEach(() => {
    component = makeComponent();
  });

  it('renders nothing for empty input', () => {
    component.data = '';
    expect(component.renderedHtml()).toBe('');
  });

  it('recomputes when data changes', () => {
    component.data = '# one';
    const first = component.renderedHtml();
    expect(first).toMatch(/<h1/);

    component.data = '# two';
    const second = component.renderedHtml();
    expect(second).toMatch(/two/);
    expect(second).not.toBe(first);
  });

  it('sanitizes through the shared renderer rather than binding raw input', () => {
    component.data = '<img src=x onerror=alert(1)>';
    const html = component.renderedHtml();
    expect(html).not.toMatch(/onerror/i);
  });

  it('defaults to mermaid and copy buttons disabled', () => {
    // Streaming is the hot path; both features are opt-in so a streamed chunk
    // never pays for them.
    expect(component.enableMermaid).toBe(false);
    expect(component.enableCodeCopy).toBe(false);
  });
});

describe('MarkdownViewerComponent — copy to clipboard', () => {
  let component: MarkdownViewerComponent;

  beforeEach(() => {
    component = makeComponent();
    component.enableCodeCopy = true;
  });

  /** Builds a <pre><code> and a click event targeting the copy button inside it. */
  function clickEventOnCopyButton(codeText: string): MouseEvent {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = codeText;
    const button = document.createElement('button');
    button.className = 'code-copy-btn';
    pre.appendChild(code);
    pre.appendChild(button);
    document.body.appendChild(pre);

    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: button });
    return event;
  }

  it('copies the code block text when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await component.onContainerClick(clickEventOnCopyButton('SELECT 1;'));

    expect(writeText).toHaveBeenCalledWith('SELECT 1;');
  });

  it('ignores clicks that are not on a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: document.createElement('span') });
    await component.onContainerClick(event);

    expect(writeText).not.toHaveBeenCalled();
  });

  it('surfaces a clipboard failure instead of swallowing it', async () => {
    // The component must not leave the user staring at an unchanged button with
    // no idea the copy failed.
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });

    await component.onContainerClick(clickEventOnCopyButton('SELECT 1;'));

    expect(component.copyError()).toMatch(/denied|failed/i);
  });
});
