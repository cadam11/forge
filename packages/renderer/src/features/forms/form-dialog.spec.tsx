/**
 * The shared form-dialog scaffolding.
 *
 * Small, and deliberately so: three of the four exports are layout, and their look is covered by the
 * both-theme browser gate. What is asserted here is the behaviour a copy-paste into Tasks 12/13 would
 * silently get wrong.
 *
 * These are NOT held to `ui/contract.spec.tsx`'s element contract, because they are not in `ui/` —
 * `form-dialog.tsx`'s header states why. The parts of that contract which still make sense (merge
 * `className`, pass `data-testid` through) are asserted below anyway, because a caller will assume
 * them.
 */

import { describe, expect, it } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';

import { FormAnswerBand, FormHint, FormNote, FormSection, useFormValues } from './index';

describe('FormAnswerBand', () => {
  it('renders nothing when it has neither a hint nor a child', () => {
    // The property Tasks 12/13 get for free: a band with nothing to say must not reserve a ruled
    // 46px strip above the action row.
    const { container } = render(<FormAnswerBand data-testid="band" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a child that is null', () => {
    // Which is why its contract asks callers for `{x === null ? null : <Panel …/>}` rather than
    // `<Panel value={x} />`: a component that returns null from its own render is still a non-null
    // element here, and the band cannot see through it.
    const { container } = render(<FormAnswerBand>{null}</FormAnswerBand>);
    expect(container.firstChild).toBeNull();
  });

  it('renders for a hint alone', () => {
    render(<FormAnswerBand hint="Server is required" hintTestId="the-hint" data-testid="band" />);

    expect(screen.getByTestId('band')).toBeTruthy();
    expect(screen.getByTestId('the-hint').textContent).toBe('Server is required');
    // `role="status"`, not `alert`: the user pressed the button directly below it.
    expect(screen.getByTestId('the-hint').getAttribute('role')).toBe('status');
  });

  it('renders for a child alone', () => {
    render(
      <FormAnswerBand data-testid="band">
        <p>the server said no</p>
      </FormAnswerBand>
    );

    expect(screen.getByTestId('band').textContent).toBe('the server said no');
  });

  it('renders both, hint first', () => {
    render(
      <FormAnswerBand hint="still wrong" data-testid="band">
        <p>and it failed</p>
      </FormAnswerBand>
    );

    expect(screen.getByTestId('band').textContent).toBe('still wrongand it failed');
  });

  it('merges className and never grows', () => {
    render(<FormAnswerBand hint="x" className="mt-0" data-testid="band" />);
    const band = screen.getByTestId('band');
    // `shrink-0` is load-bearing: the action row's reachability at the 800x600 window floor depends on
    // the scrolling body being the only flexible row.
    expect(band.className).toContain('shrink-0');
    expect(band.className).toContain('mt-0');
  });
});

describe('FormSection and FormNote', () => {
  it('renders the eyebrow and passes its testid through', () => {
    render(
      <FormSection title="SSH tunnel" data-testid="the-section">
        <p>fields</p>
      </FormSection>
    );

    const section = screen.getByTestId('the-section');
    expect(section.tagName).toBe('SECTION');
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('SSH tunnel');
    // Uppercased by the utility, not in the source — so a screen reader reads the sentence case.
    expect(screen.getByRole('heading', { level: 3 }).className).toContain('uppercase');
  });

  it('draws its own top rule, so a body is a stack of sections with no separators of its own', () => {
    render(
      <FormSection title="Options" data-testid="the-section">
        <p>x</p>
      </FormSection>
    );
    expect(screen.getByTestId('the-section').className).toContain('border-t');
  });

  it('renders a note as muted prose, never subtle', () => {
    // HOUSE-RULES §5: subtle measures 3.11:1 on light chrome and is metadata only. A note is prose.
    render(<FormNote data-testid="the-note">TLS is always on for Aurora DSQL.</FormNote>);
    const note = screen.getByTestId('the-note');
    expect(note.className).toContain('text-fg-muted');
    expect(note.className).not.toContain('text-fg-subtle');
  });

  it('paints the hint amber, which is what makes caution readable in both themes', () => {
    render(<FormHint data-testid="the-hint">careful</FormHint>);
    expect(screen.getByTestId('the-hint').className).toContain('border-warning');
  });
});

describe('useFormValues', () => {
  interface Values {
    readonly alpha: string;
    readonly beta: number;
  }

  it('returns the complete, honestly-typed values', () => {
    // The reason it is `useWatch` for the subscription and `getValues()` for the read: `useWatch`'s
    // own return type is a deep partial, which is a lie for a form with total `defaultValues`.
    const { result } = renderHook(() => {
      const form = useForm<Values>({ defaultValues: { alpha: 'a', beta: 1 } });
      return useFormValues(form);
    });

    expect(result.current).toEqual({ alpha: 'a', beta: 1 });
  });

  it('re-renders with the new value when a field changes', () => {
    let setter: ((value: string) => void) | undefined;
    const seen: string[] = [];

    const { result } = renderHook(() => {
      const form = useForm<Values>({ defaultValues: { alpha: 'a', beta: 1 } });
      setter = value => form.setValue('alpha', value);
      const values = useFormValues(form);
      seen.push(values.alpha);
      return values;
    });

    // Not an exact-equality on `seen`: how many times React renders before the first assertion is
    // React's business, and pinning it would make this a test of the renderer.
    expect(new Set(seen)).toEqual(new Set(['a']));
    // `act`, because the update happens outside React's own event handling and the re-render it
    // schedules would otherwise not have flushed by the next line.
    act(() => setter?.('b'));
    // The subscription re-rendered, and `getValues()` already reflected the change on that commit —
    // both read the same internal store, which is the assumption the split rests on.
    expect(result.current.alpha).toBe('b');
    expect(seen).toContain('b');
  });
});
