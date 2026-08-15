/**
 * The app's only `dangerouslySetInnerHTML` site.
 *
 * `eslint.config.js` bans the property everywhere except `src/markdown/`, and this is the one
 * file in `src/markdown/` that uses it. The string it receives comes from
 * `render-markdown.ts` — `marked` then DOMPurify — which is the seam CLAUDE.md's AI rules
 * mandate. Nothing else may reach `[innerHTML]`, and the Angular renderer's habit of binding
 * unsanitized strings in several places is what the ban exists to prevent recurring.
 *
 * Reachability, spelled out because it is the whole security argument:
 *
 *   1. `data` (untrusted: model output, tool results) → `renderMarkdown(data)` → sanitized.
 *   2. sanitized → `addCopyButtons` (optional), which parses into a **detached** `<template>`,
 *      appends inert `<button>`s and re-serializes. It adds markup but removes no
 *      sanitization, and a detached template neither executes script nor fetches
 *      subresources.
 *   3. the result → `dangerouslySetInnerHTML`.
 *
 * There is no fourth branch: `html` is a `useMemo` over exactly those two calls, so no caller
 * can hand this component pre-rendered HTML.
 *
 * ## Ported behaviours worth not losing
 *
 * - **Links never navigate the app window.** The main process installs no `will-navigate`
 *   guard and the preload exposes the bridge on every document load, so letting a
 *   model-authored link's default action run would hand the whole IPC surface to whatever page
 *   it pointed at. Sanitization has already reduced the scheme space; anything that is not
 *   http/https/mailto is dropped rather than opened.
 * - **Both features are opt-in.** Streaming is the hot path and a streamed chunk must not pay
 *   for mermaid or for a template round-trip.
 * - **Copy failures surface.** A user must never be left staring at an unchanged button with
 *   no idea the copy failed.
 *
 * The click handler is attached with `addEventListener` in an effect rather than as a JSX
 * `onClick`. Delegation onto a container whose children are `innerHTML` has no ARIA role to
 * give that container, and the real interactive elements — `<a>` and `<button>` — already
 * dispatch a click on Enter, so the keyboard path is native. Attaching imperatively keeps
 * that true without a lint suppression, and the listener is removed on cleanup.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ipc } from '../ipc';
import { cn } from '../ui/cn';
import { addCopyButtons, COPY_BUTTON_CLASS } from './copy-buttons';
import { renderDiagramsIn, type MermaidTheme } from './mermaid';
import { renderMarkdown } from './render-markdown';

/** Schemes a model-authored link may use. Everything else is silently dropped. */
const OPENABLE_SCHEME = /^(https?|mailto):/i;

export interface MarkdownProps {
  /** Markdown source. Partial input is expected and tolerated — mid-stream chunks arrive. */
  readonly data: string;
  readonly enableMermaid?: boolean;
  readonly enableCodeCopy?: boolean;
  /**
   * Ink-first default, matching the app's own default theme. Task 17 passes the resolved
   * theme so a diagram is not dark-on-ivory.
   */
  readonly mermaidTheme?: MermaidTheme;
  readonly className?: string;
  readonly 'data-testid'?: string;
  /**
   * Overrides how an external link is opened. Exists for tests and for a future in-app
   * documentation viewer; the default goes through the IPC bridge to the OS browser.
   */
  readonly onOpenLink?: (href: string) => Promise<void>;
}

async function openInDefaultBrowser(href: string): Promise<void> {
  await ipc().app.openExternal(href);
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function Markdown({
  data,
  enableMermaid = false,
  enableCodeCopy = false,
  mermaidTheme = 'dark',
  className,
  'data-testid': testId,
  onOpenLink = openInDefaultBrowser,
}: MarkdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [copyError, setCopyError] = useState('');
  const [diagramError, setDiagramError] = useState('');

  const html = useMemo(() => {
    const sanitized = renderMarkdown(data);
    if (sanitized === '' || !enableCodeCopy) {
      return sanitized;
    }
    return addCopyButtons(sanitized);
  }, [data, enableCodeCopy]);

  const handleClick = useCallback(
    async (event: Event): Promise<void> => {
      const target = event.target as Element | null;
      if (target === null) {
        return;
      }

      const link = target.closest('a[href]');
      if (link !== null) {
        event.preventDefault();
        const href = link.getAttribute('href') ?? '';
        if (!OPENABLE_SCHEME.test(href)) {
          return;
        }
        try {
          await onOpenLink(href);
        } catch (error) {
          setCopyError(`Could not open link: ${messageFor(error)}`);
        }
        return;
      }

      const button = target.closest(`.${COPY_BUTTON_CLASS}`);
      if (button === null) {
        return;
      }
      const code = button.closest('pre')?.querySelector('code')?.textContent ?? '';
      setCopyError('');
      try {
        await navigator.clipboard.writeText(code);
      } catch (error) {
        setCopyError(`Copy failed: ${messageFor(error)}`);
      }
    },
    [onOpenLink]
  );

  useEffect(() => {
    const root = containerRef.current;
    if (root === null) {
      return;
    }
    const listener = (event: Event) => {
      void handleClick(event);
    };
    root.addEventListener('click', listener);
    return () => {
      root.removeEventListener('click', listener);
    };
  }, [handleClick]);

  useEffect(() => {
    if (!enableMermaid) {
      return;
    }
    const root = containerRef.current;
    if (root === null) {
      return;
    }
    // New content, so any error from the previous message no longer applies.
    setDiagramError('');
    let cancelled = false;
    renderDiagramsIn(root, mermaidTheme)
      .then(failures => {
        if (!cancelled && failures.length > 0) {
          setDiagramError(failures[0] ?? '');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDiagramError(`Diagram failed to render: ${messageFor(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
    // `html` is a dependency because mermaid can only run once the sanitized markup has been
    // committed to the DOM — it is the signal that there is new content to look at.
  }, [enableMermaid, html, mermaidTheme]);

  // Both errors, so a copy failure cannot mask a diagram failure.
  const errors = [copyError, diagramError].filter(message => message !== '');

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)} data-testid={testId}>
      <div
        ref={containerRef}
        data-testid="markdown-content"
        className="markdown-prose min-w-0"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {errors.map(message => (
        <p key={message} role="alert" className="text-sm text-danger text-pretty">
          {message}
        </p>
      ))}
    </div>
  );
}
