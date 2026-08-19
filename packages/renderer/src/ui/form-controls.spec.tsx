import { createRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Checkbox } from './checkbox';
import { Input } from './input';
import { Select, SelectItem } from './select';
import { Switch } from './switch';
import { Textarea } from './textarea';

/**
 * The label association is the point of this file.
 *
 * PLAN §Task 20 makes `fillField` collapse to `getByLabel`, which the Angular suite could not
 * do — `tests/helpers/joinery-actions.ts:78-88` locates `mat-form-field` filtered by
 * `mat-label:text-is(…)` and carries a comment explaining that Material's label association
 * defeats `getByLabel`. Every control below is asserted through `getByLabelText`, which is the
 * same resolution Playwright's `getByLabel` uses. If one of these regresses, the e2e helper
 * regresses with it and the failure will look like a locator problem three tasks later.
 */

describe('label association', () => {
  it('finds a text input by its label', async () => {
    render(<Input label="Host" name="host" />);

    await userEvent.type(screen.getByLabelText('Host'), 'localhost');

    expect(screen.getByLabelText<HTMLInputElement>('Host').value).toBe('localhost');
  });

  it('finds a textarea by its label', async () => {
    render(<Textarea label="Connection string" name="connectionString" />);

    await userEvent.type(screen.getByLabelText('Connection string'), 'postgres://');

    expect(screen.getByLabelText<HTMLTextAreaElement>('Connection string').value).toBe(
      'postgres://'
    );
  });

  it('finds a checkbox by its label and toggles it', async () => {
    render(<Checkbox label="Remember this connection" name="remember" />);

    const checkbox = screen.getByLabelText<HTMLInputElement>('Remember this connection');
    expect(checkbox.checked).toBe(false);

    await userEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
  });

  it('finds a switch by its label and reports the switch role', async () => {
    const onChange = vi.fn();
    render(<Switch label="Write mode" name="writeMode" onChange={onChange} />);

    const control = screen.getByLabelText('Write mode');
    expect(control.getAttribute('role')).toBe('switch');

    await userEvent.click(control);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('finds the Radix select by its label, through a real <label for>', () => {
    render(
      <Select label="Engine" name="engine" defaultValue="postgres">
        <SelectItem value="postgres">PostgreSQL</SelectItem>
      </Select>
    );

    const trigger = screen.getByLabelText('Engine');
    // A <button> is a labelable element, so this is a real association rather than an ARIA
    // patch — which is what makes `getByLabel` work on it at all.
    expect(trigger.tagName).toBe('BUTTON');
    const label = trigger.ownerDocument.querySelector(`label[for="${trigger.id}"]`);
    expect(label?.textContent).toBe('Engine');
  });

  it('gives every control an id even when the caller supplies none', () => {
    render(
      <>
        <Input label="A" name="a" />
        <Input label="B" name="b" />
      </>
    );

    const a = screen.getByLabelText('A');
    const b = screen.getByLabelText('B');
    expect(a.id).not.toBe('');
    expect(a.id).not.toBe(b.id);
  });

  it('honours an id the caller owns', () => {
    render(<Input label="Host" name="host" id="connection-host" />);

    expect(screen.getByLabelText('Host').id).toBe('connection-host');
  });
});

describe('hint and error wiring', () => {
  it('describes the control with its hint', () => {
    render(<Input label="Port" name="port" hint="Blank uses the engine default." />);

    const input = screen.getByLabelText('Port');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy).not.toBe('');
    expect(input.ownerDocument.getElementById(describedBy)?.textContent).toBe(
      'Blank uses the engine default.'
    );
  });

  it('marks the control invalid and announces the error', () => {
    render(<Input label="Host" name="host" error="Unreachable." />);

    const input = screen.getByLabelText('Host');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Unreachable.');
  });

  it('references the hint AND the error when both are shown', () => {
    render(<Input label="Host" name="host" hint="A hostname or IP." error="Unreachable." />);

    const ids = (screen.getByLabelText('Host').getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toHaveLength(2);
    const texts = ids.map(id => document.getElementById(id)?.textContent);
    expect(texts).toContain('A hostname or IP.');
    expect(texts).toContain('Unreachable.');
  });

  it('sets no aria-invalid when there is no error', () => {
    render(<Input label="Host" name="host" />);

    expect(screen.getByLabelText('Host').getAttribute('aria-invalid')).toBeNull();
  });
});

describe('Checkbox — the mixed state', () => {
  it('sets the DOM property, which is the only way :indeterminate can match', () => {
    render(<Checkbox label="Some schemas" name="schemas" indeterminate />);

    const checkbox = screen.getByLabelText<HTMLInputElement>('Some schemas');
    // There is no HTML attribute for this, so a component that only rendered markup would
    // silently show an unchecked box.
    expect(checkbox.indeterminate).toBe(true);
  });

  it('still forwards a ref the caller passed', () => {
    const seen: (HTMLInputElement | null)[] = [];
    render(
      <Checkbox
        label="Some schemas"
        name="schemas"
        indeterminate
        ref={node => {
          seen.push(node);
        }}
      />
    );

    expect(seen[0]).toBeInstanceOf(HTMLInputElement);
    expect(seen[0]?.indeterminate).toBe(true);
  });
});

describe('Select — the props the Root and the trigger split', () => {
  /** Controlled, like a Task 8 caller whose open state lives in a store. */
  function ControlledSelect({ onOpenChange }: { readonly onOpenChange: (open: boolean) => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <output data-testid="open-state">{String(open)}</output>
        <Select
          label="Engine"
          name="engine"
          defaultValue="postgres"
          open={open}
          onOpenChange={next => {
            onOpenChange(next);
            setOpen(next);
          }}
        >
          <SelectItem value="postgres">PostgreSQL</SelectItem>
          <SelectItem value="mysql">MySQL</SelectItem>
        </Select>
      </>
    );
  }

  it('round-trips a controlled open state', async () => {
    const onOpenChange = vi.fn();
    render(<ControlledSelect onOpenChange={onOpenChange} />);

    expect(screen.queryByRole('listbox')).toBeNull();

    await userEvent.click(screen.getByLabelText('Engine'));

    // The list is open because the callback wrote the state back, not because the trigger
    // opened itself: a `Select` that ignored `open` would fail the second assertion only.
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('listbox')).toBeDefined();

    await userEvent.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('open-state').textContent).toBe('false');
  });

  it('stays shut when the caller holds open false', async () => {
    render(
      <Select label="Engine" name="engine" open={false} onOpenChange={vi.fn()}>
        <SelectItem value="postgres">PostgreSQL</SelectItem>
      </Select>
    );

    await userEvent.click(screen.getByLabelText('Engine'));

    // Controlled means controlled. Without this, "round-trips" above would pass on a component
    // that merely opened itself and reported it.
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('passes the trigger’s own props through to the trigger', async () => {
    const onBlur = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <>
        <Select
          ref={ref}
          label="Engine"
          name="engine"
          onBlur={onBlur}
          form="connection-form"
          aria-labelledby="external-label"
          defaultValue="postgres"
        >
          <SelectItem value="postgres">PostgreSQL</SelectItem>
        </Select>
        <button type="button">Elsewhere</button>
      </>
    );

    const trigger = screen.getByRole('combobox');
    expect(ref.current).toBe(trigger);
    expect(trigger.getAttribute('aria-labelledby')).toBe('external-label');
    // `form` belongs to the hidden native <select> Radix renders for form participation, not to
    // the trigger — a <button form> would submit the form instead of associating with it.
    expect(trigger.getAttribute('form')).toBeNull();
    expect(document.querySelector('select[form="connection-form"]')).not.toBeNull();

    trigger.focus();
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));

    expect(onBlur).toHaveBeenCalled();
  });
});

describe('focus rings', () => {
  it('insets the input ring, per form-controls.md', () => {
    render(<Input label="Host" name="host" />);

    const className = screen.getByLabelText('Host').className;
    expect(className).toContain('focus-visible:outline-2');
    // An outset offset on a bordered input reads as a double border, which the guideline
    // forbids for inputs and textareas specifically.
    expect(className).toContain('focus-visible:-outline-offset-1');
    expect(className).not.toContain('focus-visible:outline-offset-2');
  });

  it('rings the switch track rather than the transparent input over it', () => {
    render(<Switch label="Write mode" name="writeMode" />);

    const input = screen.getByLabelText('Write mode');
    expect(input.className).toContain('focus:outline-hidden');
    expect(input.parentElement?.className).toContain('has-focus-visible:outline-2');
  });
});
