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
