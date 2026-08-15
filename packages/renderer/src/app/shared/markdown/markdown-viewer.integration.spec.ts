// @vitest-environment jsdom
import '@angular/compiler';
import 'zone.js';
import 'zone.js/testing';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing';
import { of } from 'rxjs';
import { IpcService } from '../../core/services/ipc.service';
import { MarkdownViewerComponent } from './markdown-viewer.component';

/**
 * What these DO test: that the `[innerHTML]` binding lands in a real DOM under a
 * real change-detection pass, across the many small input changes that streaming
 * produces, and that no executable payload survives into the live document.
 *
 * What they do NOT test, stated plainly: they are not evidence that the signal
 * implementation is what keeps streaming alive. A mutant with every signal removed
 * — plain fields and plain getters, no `computed`, no `markForCheck` — passes all
 * of these. That is structural: `fixture.detectChanges()` marks an OnPush child
 * dirty whenever a bound `@Input` changes, so an input-driven render keeps up
 * either way. The failure mode the old component actually had was an
 * *asynchronous* render completing outside the CD pass, which nothing here
 * simulates.
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

beforeEach(() => {
  // Vitest does not wire Angular's per-test hooks, so the module must be reset
  // explicitly or the second configureTestingModule call throws.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: IpcService, useValue: { openExternal: () => of(undefined) } }],
  });
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
