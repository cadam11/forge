import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Spinner, spinnerLabelClass } from './spinner';

/**
 * The port of `packages/renderer/src/app/shared/components/loading/loading.component.spec.ts`.
 *
 * That spec's whole content was the size/animation class lookup and its fallback, which was
 * worth testing because the lookup was loosely keyed on purpose — an out-of-vocabulary runtime
 * value had to fall back rather than produce `class="undefined"`. `Spinner` keeps that shape,
 * so the contract ports directly even though the vocabulary changed from `small|medium|large`
 * to the icon ladder.
 *
 * Two of the original's four cases have no equivalent: there is one animation now (the ring
 * spins; the old pulse is gone, per `interactivity.md`), and `text` defaulting to `''` is
 * replaced by `label` being absent, which is what the aria-label case below covers.
 */

describe('Spinner — size mapping', () => {
  it('maps each known size to its caption rung', () => {
    expect(spinnerLabelClass('sm')).toBe('text-sm');
    expect(spinnerLabelClass('md')).toBe('text-base');
    expect(spinnerLabelClass('lg')).toBe('text-base');
  });

  it('falls back to the md rung for an unknown size value', () => {
    // The Angular original's equivalent case. Reachable because a size can arrive from
    // untyped data at runtime.
    expect(spinnerLabelClass('huge' as unknown as 'md')).toBe('text-base');
  });

  // `svg.className` is an `SVGAnimatedString`, not a string — the attribute is what has to be
  // read on an SVG element.
  it('sizes the mark from the icon ladder, never the type scale', () => {
    render(
      <>
        <Spinner size="sm" data-testid="sm" />
        <Spinner size="md" data-testid="md" />
        <Spinner size="lg" data-testid="lg" />
      </>
    );

    expect(screen.getByTestId('sm').querySelector('svg')?.getAttribute('class')).toContain(
      'size-3.5'
    );
    expect(screen.getByTestId('md').querySelector('svg')?.getAttribute('class')).toContain(
      'size-4'
    );
    expect(screen.getByTestId('lg').querySelector('svg')?.getAttribute('class')).toContain(
      'size-5'
    );
  });
});

describe('Spinner — announcement', () => {
  it('announces itself when it has no visible caption', () => {
    render(<Spinner data-testid="spinner" />);

    const spinner = screen.getByTestId('spinner');
    expect(spinner.getAttribute('role')).toBe('status');
    expect(spinner.getAttribute('aria-label')).toBe('Loading');
  });

  it('lets the visible caption do the announcing when there is one', () => {
    render(<Spinner label="Connecting…" data-testid="spinner" />);

    const spinner = screen.getByTestId('spinner');
    // No aria-label: it would override the text a sighted user is reading.
    expect(spinner.getAttribute('aria-label')).toBeNull();
    expect(spinner.textContent).toBe('Connecting…');
  });

  it('animates the mark rather than the whole component', () => {
    render(<Spinner label="Working" data-testid="spinner" />);

    const spinner = screen.getByTestId('spinner');
    expect(spinner.className).not.toContain('animate-spin');
    expect(spinner.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
  });

  it('merges a caller class and bakes no margin', () => {
    render(<Spinner className="text-base" data-testid="spinner" />);

    expect(screen.getByTestId('spinner').className).not.toMatch(/(?:^|\s)-?m[trblxy]?-/);
  });
});
