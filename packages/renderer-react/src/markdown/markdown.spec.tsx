import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { addCopyButtons } from './copy-buttons';
import { Markdown } from './markdown';

/**
 * The port of `packages/renderer/src/app/shared/markdown/markdown-viewer.component.spec.ts`.
 *
 * That spec tested the Angular class without a TestBed, so it could only reach the sanitized
 * *string*. This one renders the component, which means the XSS cases below are asserted against
 * the **live DOM** — the thing that actually matters for a `dangerouslySetInnerHTML` site, and a
 * strictly stronger claim than the string assertions in `render-markdown.spec.ts`.
 *
 * `onOpenLink` is injected in the link tests rather than mocking the IPC layer: the default goes
 * through `ipc()`, which correctly throws outside Electron, and the point of these tests is the
 * scheme guard and the prevented navigation, not the bridge.
 */

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  // `navigator` is a shared jsdom global; leaving a stub on it makes later specs in this file
  // order-dependent. (Kept from the Angular spec, which learned this the hard way.)
  if (originalClipboard) {
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  } else {
    delete (navigator as { clipboard?: unknown }).clipboard;
  }
});

function content(): HTMLElement {
  return screen.getByTestId('markdown-content');
}

describe('Markdown — rendering', () => {
  it('renders nothing for empty input', () => {
    render(<Markdown data="" />);

    expect(content().innerHTML).toBe('');
  });

  it('recomputes when data changes', () => {
    const { rerender } = render(<Markdown data="# one" />);
    expect(content().querySelector('h1')?.textContent).toBe('one');

    rerender(<Markdown data="# two" />);
    expect(content().querySelector('h1')?.textContent).toBe('two');
  });

  it('renders the markdown the chat prose styles expect', () => {
    render(<Markdown data={'| a | b |\n| - | - |\n| 1 | 2 |\n'} />);

    expect(content().querySelector('table')).not.toBeNull();
    expect(content().querySelector('th')).not.toBeNull();
  });

  it('carries the prose class, which is where the sanitized markup gets its styling', () => {
    render(<Markdown data="text" />);

    // The parsed elements cannot take Tailwind classes, so the styling has to hang off an
    // ancestor — see markdown.css.
    expect(content().className).toContain('markdown-prose');
  });

  it('merges a caller class on the root and bakes no margin', () => {
    render(<Markdown data="text" className="max-w-full" data-testid="md" />);

    const root = screen.getByTestId('md');
    expect(root.className).toContain('max-w-full');
    expect(root.className).not.toMatch(/(?:^|\s)-?m[trblxy]?-/);
  });

  it('opts out of mermaid and copy buttons by default', () => {
    // Streaming is the hot path; a streamed chunk must not pay for either.
    render(<Markdown data={'```sql\nSELECT 1;\n```'} />);

    expect(content().querySelector('.code-copy-btn')).toBeNull();
  });
});

describe('Markdown — the sanitize seam reaches the DOM', () => {
  it('renders a script tag inert', () => {
    render(<Markdown data="<script>alert(1)</script>" />);

    expect(content().querySelector('script')).toBeNull();
    expect(content().innerHTML).not.toMatch(/<script/i);
  });

  it('strips inline event handlers from the live element', () => {
    render(<Markdown data="<img src=x onerror=alert(1)>" />);

    const img = content().querySelector('img');
    // Either the element is gone or the handler is; both are acceptable, live is not.
    expect(img?.getAttribute('onerror') ?? null).toBeNull();
    expect(content().innerHTML).not.toMatch(/\son\w+\s*=/i);
  });

  it('strips javascript: hrefs, including the entity-encoded form', () => {
    render(
      <Markdown
        data={'<a href="javascript:alert(1)">a</a><a href="&#x6a;avascript:alert(1)">b</a>'}
      />
    );

    for (const anchor of content().querySelectorAll('a')) {
      expect(anchor.getAttribute('href') ?? '').not.toMatch(/javascript:/i);
    }
    expect(content().innerHTML).not.toMatch(/javascript:/i);
  });

  it('renders no iframe and no srcdoc', () => {
    render(<Markdown data={'<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'} />);

    expect(content().querySelector('iframe')).toBeNull();
    expect(content().innerHTML).not.toMatch(/srcdoc/i);
  });

  it('renders no style element, which could restyle the whole app', () => {
    render(<Markdown data="<style>body{display:none}</style>" />);

    expect(content().querySelector('style')).toBeNull();
  });

  it('renders no form controls that could spoof the app’s own chrome', () => {
    render(
      <Markdown data="<form><button formaction='javascript:alert(1)'>Approve</button><input type='text'></form>" />
    );

    expect(content().querySelector('form')).toBeNull();
    expect(content().querySelector('button')).toBeNull();
    expect(content().querySelector('input')).toBeNull();
  });

  it('keeps the GFM task-list checkbox, disabled', () => {
    render(<Markdown data={'- [x] done\n- [ ] todo'} />);

    const checkboxes = content().querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    for (const checkbox of checkboxes) {
      expect(checkbox.disabled).toBe(true);
    }
  });
});

describe('Markdown — links', () => {
  it('opens an http link externally instead of navigating the app window', async () => {
    const onOpenLink = vi.fn().mockResolvedValue(undefined);
    render(<Markdown data="[docs](https://example.com/a)" onOpenLink={onOpenLink} />);

    await userEvent.click(screen.getByRole('link', { name: 'docs' }));

    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/a');
  });

  it('opens mailto too', async () => {
    const onOpenLink = vi.fn().mockResolvedValue(undefined);
    render(<Markdown data="[mail](mailto:a@example.com)" onOpenLink={onOpenLink} />);

    await userEvent.click(screen.getByRole('link', { name: 'mail' }));

    expect(onOpenLink).toHaveBeenCalledWith('mailto:a@example.com');
  });

  it('drops a scheme it does not open rather than handing it to the OS', async () => {
    // `tel:` survives sanitization, so the component's own allowlist is the last gate. The main
    // process installs no `will-navigate` guard, so "drop it" is the only safe default.
    const onOpenLink = vi.fn().mockResolvedValue(undefined);
    render(<Markdown data="[call](tel:+15551234)" onOpenLink={onOpenLink} />);

    await userEvent.click(screen.getByRole('link', { name: 'call' }));

    expect(onOpenLink).not.toHaveBeenCalled();
  });

  it('surfaces a failure to open instead of swallowing it', async () => {
    const onOpenLink = vi.fn().mockRejectedValue(new Error('no bridge'));
    render(<Markdown data="[docs](https://example.com/a)" onOpenLink={onOpenLink} />);

    await userEvent.click(screen.getByRole('link', { name: 'docs' }));

    expect(screen.getByRole('alert').textContent).toMatch(/no bridge/);
  });
});

describe('Markdown — copy to clipboard', () => {
  it('places the copy button inside the pre it copies from', () => {
    // `button.closest('pre')` is how the handler finds the code. If the button ends up outside
    // the <pre>, copying silently yields ''. (Ported: the Angular spec found this exact bug.)
    const host = document.createElement('div');
    host.innerHTML = addCopyButtons('<pre><code>SELECT 1;</code></pre>');

    expect(host.querySelector('pre > .code-copy-btn')).not.toBeNull();
  });

  it('copies the code block text when the copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Markdown data={'```sql\nSELECT 1;\n```'} enableCodeCopy />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith('SELECT 1;\n');
  });

  it('ignores clicks that are not on a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Markdown data={'text\n\n```sql\nSELECT 1;\n```'} enableCodeCopy />);

    await userEvent.click(screen.getByText('text'));

    expect(writeText).not.toHaveBeenCalled();
  });

  it('surfaces a clipboard failure instead of swallowing it', async () => {
    // The user must not be left staring at an unchanged button with no idea the copy failed.
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Markdown data={'```sql\nSELECT 1;\n```'} enableCodeCopy />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(screen.getByRole('alert').textContent).toMatch(/denied|failed/i);
  });
});
