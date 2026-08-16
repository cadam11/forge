/**
 * The pane divider, keyboard-first.
 *
 * The audit's finding is that the Angular handle was a 4px mouse-only target with no role, no focus
 * style and no keyboard path (§1.9). Every assertion below is one half of that finding closed, and
 * the sign handling gets its own tests because a divider on the RIGHT of its pane inverts the
 * mapping — arrow-right shrinks the assistant while it grows the sidebar, and that is exactly the
 * kind of thing that ships backwards.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResizeHandle } from './resize-handle';

const BASE = { label: 'Sidebar width', testId: 'handle', min: 180, max: 500, value: 280 } as const;

function renderHandle(overrides: Partial<React.ComponentProps<typeof ResizeHandle>> = {}) {
  const onChange = vi.fn();
  const onReset = vi.fn();
  render(
    <ResizeHandle {...BASE} edge="leading" onChange={onChange} onReset={onReset} {...overrides} />
  );
  return { onChange, onReset, handle: screen.getByTestId('handle') };
}

describe('the resize handle', () => {
  it('exposes the ARIA window-splitter contract', () => {
    const { handle } = renderHandle();

    // Plain `getAttribute`, because this package deliberately ships no jest-dom matchers — see
    // `ui/contract.spec.tsx`, which asserts the same way.
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('280');
    expect(handle.getAttribute('aria-valuemin')).toBe('180');
    expect(handle.getAttribute('aria-valuemax')).toBe('500');
    expect(handle.getAttribute('aria-label')).toBe('Sidebar width');
  });

  it('is reachable by keyboard at all', () => {
    const { handle } = renderHandle();
    expect(handle.getAttribute('tabindex')).toBe('0');
  });

  it('nudges with the arrow keys', async () => {
    const user = userEvent.setup();
    const { onChange, handle } = renderHandle();
    handle.focus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(288);

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(272);
  });

  it('moves further with shift held', async () => {
    const user = userEvent.setup();
    const { onChange, handle } = renderHandle();
    handle.focus();

    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(onChange).toHaveBeenLastCalledWith(312);
  });

  it('jumps to the extremes with Home and End', async () => {
    const user = userEvent.setup();
    const { onChange, handle } = renderHandle();
    handle.focus();

    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(180);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(500);
  });

  it('inverts the arrow keys for a trailing pane', async () => {
    // The assistant panel is to the RIGHT of its divider, so arrow-right must shrink it. Home and
    // End follow: "towards the pane" is still the smaller value.
    const user = userEvent.setup();
    const { onChange, handle } = renderHandle({ edge: 'trailing', value: 360, min: 280, max: 640 });
    handle.focus();

    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith(352);
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(368);
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenLastCalledWith(640);
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenLastCalledWith(280);
  });

  it('clamps to its own bounds', async () => {
    const user = userEvent.setup();
    const { onChange, handle } = renderHandle({ value: 182 });
    handle.focus();

    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenLastCalledWith(180);
  });

  it('resets on Enter and on double-click', async () => {
    const user = userEvent.setup();
    const { onReset, handle } = renderHandle();
    handle.focus();

    await user.keyboard('{Enter}');
    expect(onReset).toHaveBeenCalledTimes(1);

    await user.dblClick(handle);
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it('leaves keys it does not handle alone', async () => {
    // The shell owns ⌘J on the document; a divider that swallowed every keydown would eat it.
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    document.addEventListener('keydown', onKeyDown);
    const { onChange, handle } = renderHandle();
    handle.focus();

    await user.keyboard('j');

    expect(onChange).not.toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalled();
    expect(
      onKeyDown.mock.calls.every(([event]) => !(event as KeyboardEvent).defaultPrevented)
    ).toBe(true);
    document.removeEventListener('keydown', onKeyDown);
  });

  it('restores text selection when unmounted mid-drag', () => {
    // A drag interrupted by a re-render must not leave the document permanently unselectable.
    const view = render(
      <ResizeHandle {...BASE} edge="leading" onChange={vi.fn()} onReset={vi.fn()} />
    );
    const handle = screen.getByTestId('handle');
    // jsdom implements neither `PointerEvent` nor pointer capture. A `MouseEvent` named
    // `pointerdown` is what React's synthetic pointer handler actually listens for, and
    // `setPointerCapture` is stubbed in `test/setup.ts` — between them that is enough to reach the
    // one thing under test here, the `user-select` write and its teardown.
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(document.body.style.userSelect).toBe('none');

    view.unmount();
    expect(document.body.style.userSelect).toBe('');
  });
});
