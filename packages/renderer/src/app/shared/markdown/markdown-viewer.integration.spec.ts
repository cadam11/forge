// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { describe, it, expect, beforeAll } from 'vitest';
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { MarkdownViewerComponent } from './markdown-viewer.component';

/**
 * The one thing the class-level specs cannot reach: real change detection, and the
 * `[innerHTML]` binding actually landing in the DOM.
 *
 * The component this replaces rendered asynchronously and had to call
 * `markForCheck()` afterwards or streamed output froze under OnPush. This
 * implementation renders through `computed()` signals read in the template, so the
 * view is marked dirty structurally and there is no call to forget. These tests
 * drive an OnPush host the way streaming does and assert the DOM keeps up.
 */

/** Stands in for the chat panel: OnPush, feeding a signal into [data]. */
@Component({
  standalone: true,
  imports: [MarkdownViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-markdown
    [data]="content()"
    [enableCodeCopy]="copy()"
    containerClass="chat-md"
  />`,
})
class StreamingHostComponent {
  readonly content = signal('');
  readonly copy = signal(false);
}

beforeAll(() => {
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
});

describe('MarkdownViewerComponent under OnPush change detection', () => {
  it('renders markdown into the DOM', () => {
    const fixture = TestBed.createComponent(StreamingHostComponent);
    fixture.componentInstance.content.set('# hello');
    fixture.detectChanges();

    const heading = fixture.nativeElement.querySelector('h1');
    expect(heading?.textContent).toContain('hello');
  });

  it('applies containerClass so the chat CSS still matches', () => {
    const fixture = TestBed.createComponent(StreamingHostComponent);
    fixture.componentInstance.content.set('text');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.markdown-container.chat-md')).not.toBeNull();
  });

  it('updates the DOM on every chunk of a simulated stream', () => {
    // Chat binds [data]="state.streamingContent()", so this is the shape of the
    // real streaming path: many small input changes into an OnPush child.
    const fixture = TestBed.createComponent(StreamingHostComponent);
    const chunks = ['Loading', 'Loading the', 'Loading the schema', 'Loading the schema **now**'];

    for (const chunk of chunks) {
      fixture.componentInstance.content.set(chunk);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain(chunk.replace(/\*\*/g, ''));
    }

    expect(fixture.nativeElement.querySelector('strong')?.textContent).toBe('now');
  });

  it('renders a fenced code block with its language class intact', () => {
    const fixture = TestBed.createComponent(StreamingHostComponent);
    fixture.componentInstance.content.set('```sql\nSELECT 1;\n```');
    fixture.detectChanges();

    const code = fixture.nativeElement.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code.className).toContain('language-sql');
  });

  it('renders a GFM table', () => {
    const fixture = TestBed.createComponent(StreamingHostComponent);
    fixture.componentInstance.content.set('| a | b |\n| - | - |\n| 1 | 2 |');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('table').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('td').length).toBe(2);
  });

  it('does not inject a copy button into the DOM until copy is enabled', () => {
    const fixture = TestBed.createComponent(StreamingHostComponent);
    fixture.componentInstance.content.set('```sql\nSELECT 1;\n```');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.code-copy-btn')).toBeNull();

    // Chat enables copy only on settled messages, never mid-stream.
    fixture.componentInstance.copy.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.code-copy-btn')).not.toBeNull();
  });

  it('never puts an executable payload into the live DOM', () => {
    const fixture = TestBed.createComponent(StreamingHostComponent);
    fixture.componentInstance.content.set(
      '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    );
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('onerror')).toBeFalsy();
  });
});
