import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Database } from 'lucide-react';

import { Button } from './button';
import { EmptyState, emptyStateTitleClass } from './empty-state';

/**
 * This component retires 19 divergent Angular implementations, so the thing worth testing is
 * that its API actually spans their cases — glyph, title, one sentence, at most one action —
 * and that the two sizes stay two.
 */

describe('EmptyState', () => {
  it('renders the four parts the 19 originals between them needed', () => {
    render(
      <EmptyState
        icon={Database}
        title="No connection"
        description="Connect to a server to browse its databases."
        action={<Button>New connection</Button>}
        data-testid="empty"
      />
    );

    expect(screen.getByTestId('empty-state-icon')).toBeDefined();
    expect(screen.getByText('No connection')).toBeDefined();
    expect(screen.getByText('Connect to a server to browse its databases.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'New connection' })).toBeDefined();
  });

  it('renders a bare title with nothing else', () => {
    render(<EmptyState title="Nothing here" data-testid="empty" />);

    expect(screen.queryByTestId('empty-state-icon')).toBeNull();
    expect(screen.getByTestId('empty').textContent).toBe('Nothing here');
  });

  it('uses the display face only at the size a whole tab gets', () => {
    // A 28px Archivo headline in a 240px rail is comic, which is what the `sm` rung is for.
    expect(emptyStateTitleClass('md')).toContain('font-display');
    expect(emptyStateTitleClass('md')).toContain('text-display-sm');
    expect(emptyStateTitleClass('sm')).not.toContain('font-display');
    expect(emptyStateTitleClass('sm')).toContain('text-lg');
  });

  it('falls back to the md rung for an unknown size', () => {
    expect(emptyStateTitleClass('huge' as unknown as 'md')).toBe(emptyStateTitleClass('md'));
  });

  it('never overrides the display token’s baked tracking or leading', () => {
    // HOUSE-RULES §2: the display rungs carry letter-spacing and line-height in the token.
    const className = emptyStateTitleClass('md');
    expect(className).not.toMatch(/\bleading-/);
    expect(className).not.toMatch(/\btracking-/);
  });

  it('wraps in no card and bakes no margin', () => {
    render(<EmptyState title="Nothing here" data-testid="empty" />);

    const root = screen.getByTestId('empty');
    // surfaces.md puts whitespace first, and an empty state is whitespace by definition.
    expect(root.className).not.toMatch(/\bborder\b/);
    expect(root.className).not.toMatch(/(?:^|\s)-?m[trblxy]?-/);
  });

  it('merges a caller class onto the root', () => {
    render(<EmptyState title="Nothing here" className="h-full" data-testid="empty" />);

    expect(screen.getByTestId('empty').className).toContain('h-full');
  });
});
