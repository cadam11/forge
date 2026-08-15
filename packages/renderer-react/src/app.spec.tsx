import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './app';

// Smoke test: the only proof that the jsdom vitest project, the .tsx transform
// and the setup file are actually wired up. Real coverage arrives with real UI.
describe('App', () => {
  it('renders the placeholder root', () => {
    render(<App />);

    expect(screen.getByTestId('renderer-react-root')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Joinery renderer-react');
  });
});
