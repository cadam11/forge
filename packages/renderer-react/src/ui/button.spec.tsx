import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Play } from 'lucide-react';

import { Button } from './button';

/**
 * `buttons.md`'s numeric constraints are asserted from the emitted utilities rather than from
 * `getBoundingClientRect`, because jsdom applies no stylesheet — every element measures 0×0
 * there. The utilities are the honest source: Tailwind's spacing multiplier is 0.25rem, so
 * `h-7` IS 28px, and asserting the class is asserting the height.
 */

/** `h-7` -> 28, `h-8.5` -> 34. Tailwind's spacing scale is `n * 4px`. */
function heightPx(element: HTMLElement): number {
  const match = /(?:^|\s)h-([\d.]+)(?:\s|$)/.exec(element.className);
  const size = /(?:^|\s)size-([\d.]+)(?:\s|$)/.exec(element.className);
  const rung = match?.[1] ?? size?.[1];
  if (rung === undefined) {
    throw new Error(`no height utility on "${element.className}"`);
  }
  return Number(rung) * 4;
}

describe('Button — the two heights', () => {
  it('ships exactly two, at least 6px apart, inside 28-38px', () => {
    render(
      <>
        <Button size="sm" data-testid="sm">
          Small
        </Button>
        <Button size="md" data-testid="md">
          Medium
        </Button>
      </>
    );

    const small = heightPx(screen.getByTestId('sm'));
    const medium = heightPx(screen.getByTestId('md'));

    expect(small).toBe(28);
    expect(medium).toBe(34);
    expect(medium - small).toBeGreaterThanOrEqual(6);
    for (const height of [small, medium]) {
      expect(height).toBeGreaterThanOrEqual(28);
      expect(height).toBeLessThanOrEqual(38);
    }
  });

  it('keeps the icon-only shape square at the same two heights', () => {
    render(
      <>
        <Button size="sm" iconOnly leadingIcon={Play} aria-label="Run" data-testid="sm" />
        <Button size="md" iconOnly leadingIcon={Play} aria-label="Run" data-testid="md" />
      </>
    );

    expect(heightPx(screen.getByTestId('sm'))).toBe(28);
    expect(heightPx(screen.getByTestId('md'))).toBe(34);
  });
});

describe('Button — contract', () => {
  it('is type=button unless the caller asks for a submit', () => {
    render(
      <>
        <Button data-testid="default">Default</Button>
        <Button type="submit" data-testid="submit">
          Save
        </Button>
      </>
    );

    expect(screen.getByTestId('default').getAttribute('type')).toBe('button');
    expect(screen.getByTestId('submit').getAttribute('type')).toBe('submit');
  });

  it('lets a caller class override the variant it conflicts with', () => {
    render(
      <Button variant="primary" className="h-7 bg-surface" data-testid="button">
        Override
      </Button>
    );

    const className = screen.getByTestId('button').className;
    expect(className).toContain('bg-surface');
    expect(className).not.toContain('bg-accent-strong');
    expect(className).toContain('h-7');
    expect(className).not.toContain('h-8.5');
  });

  it('carries a :focus-visible ring in every variant', () => {
    for (const variant of ['primary', 'outline', 'ghost', 'danger'] as const) {
      const { unmount } = render(
        <Button variant={variant} data-testid="button">
          Focus
        </Button>
      );
      expect(screen.getByTestId('button').className).toContain('focus-visible:outline-focus');
      unmount();
    }
  });

  it('bakes no margin', () => {
    render(<Button data-testid="button">No margin</Button>);
    expect(screen.getByTestId('button').className).not.toMatch(/(?:^|\s)-?m[trblxy]?-/);
  });

  it('renders leading and trailing glyphs as decorative', () => {
    render(
      <Button leadingIcon={Play} data-testid="button">
        Execute
      </Button>
    );

    const svg = screen.getByTestId('button').querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    // `svg.className` is an `SVGAnimatedString`, so the attribute is what has to be read.
    expect(svg?.getAttribute('class')).toContain('shrink-0');
  });

  it('disarms the filled variant when it is disabled, and fades the rest', async () => {
    // A filled button at half opacity is still a filled block of accent — it goes on looking like
    // the action, which is worst exactly where it is disabled for a reason (the confirm step of a
    // destructive flow). The fill is dropped instead. The outlined variants have no fill to drop, so
    // the shared fade is enough for them.
    render(
      <>
        <Button variant="primary" disabled data-testid="primary">
          Restore
        </Button>
        <Button variant="danger" disabled data-testid="danger">
          Delete
        </Button>
      </>
    );

    const primary = screen.getByTestId('primary').className;
    expect(primary).toContain('disabled:bg-active');
    expect(primary).toContain('disabled:text-fg-muted');
    // tailwind-merge resolves the two `disabled:opacity-*` against each other, so the variant's wins
    // and the label keeps its contrast.
    expect(primary).toContain('disabled:opacity-100');
    expect(primary).not.toContain('disabled:opacity-50');

    const danger = screen.getByTestId('danger').className;
    expect(danger).toContain('disabled:opacity-50');
    expect(danger).not.toContain('disabled:bg-active');
  });

  it('does not fire while disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick} data-testid="button">
        Disabled
      </Button>
    );

    await userEvent.click(screen.getByTestId('button'), { pointerEventsCheck: 0 });

    expect(onClick).not.toHaveBeenCalled();
  });
});
