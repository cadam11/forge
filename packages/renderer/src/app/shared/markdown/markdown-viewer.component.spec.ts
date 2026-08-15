// @vitest-environment jsdom
import '@angular/compiler';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElementRef, Injector, runInInjectionContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { of } from 'rxjs';
import { IpcService } from '../../core/services/ipc.service';
import { MarkdownViewerComponent, addCopyButtons } from './markdown-viewer.component';

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
      { provide: IpcService, useValue: { openExternal: () => of(undefined) } },
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
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  beforeEach(() => {
    component = makeComponent();
    component.enableCodeCopy = true;
  });

  afterEach(() => {
    // navigator is a shared jsdom global; leaving a stub on it makes later specs
    // in this file order-dependent.
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
    document.body.innerHTML = '';
  });

  /**
   * Builds the click event from the component's OWN `addCopyButtons` output rather
   * than a hand-made DOM. Hand-building it hid a total breakage: moving the button
   * from inside <pre> to after it makes every copy write the empty string, and a
   * hand-made fixture still passed.
   */
  function clickEventOnCopyButton(codeText: string): MouseEvent {
    const host = document.createElement('div');
    host.innerHTML = addCopyButtons(`<pre><code>${codeText}</code></pre>`);
    document.body.appendChild(host);

    const button = host.querySelector('.code-copy-btn');
    expect(button, 'addCopyButtons must place a .code-copy-btn in the markup').not.toBeNull();

    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: button });
    return event;
  }

  it('places the copy button inside the pre it copies from', () => {
    // `button.closest('pre')` is how the handler finds the code. If the button
    // ends up outside the <pre>, copying silently yields ''.
    const host = document.createElement('div');
    host.innerHTML = addCopyButtons('<pre><code>SELECT 1;</code></pre>');
    expect(host.querySelector('pre > .code-copy-btn')).not.toBeNull();
  });

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
