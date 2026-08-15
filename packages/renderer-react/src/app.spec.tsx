import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './app';

// Smoke test: the only proof that the jsdom vitest project, the .tsx transform
// and the setup file are actually wired up. Real coverage arrives with real UI.
describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('renders the token preview', () => {
    render(<App />);

    expect(screen.getByTestId('renderer-react-root')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Theme preview');
  });

  it('writes the theme preference onto <html> so the CSS variants have something to match', () => {
    render(<App />);

    expect(document.documentElement.getAttribute('data-theme')).toBe('system');
  });

  it('adopts the persisted preference from the key the Angular renderer writes', () => {
    window.localStorage.setItem('joinery-settings', JSON.stringify({ theme: 'light' }));

    render(<App />);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('theme-light').getAttribute('aria-pressed')).toBe('true');
  });

  it('reports browser mode from the IPC probe when preload never ran', () => {
    // No window.joinery in jsdom, which is the same state as opening :4200 in a browser.
    // The page renders the guard's answer instead of throwing on the way to the bridge.
    render(<App />);

    expect(screen.getByTestId('ipc-probe-available').textContent).toBe('browser mode');
    expect(screen.getByTestId('ipc-probe-version').textContent).toBe('not called');
  });

  it('renders one swatch per registered colour token', () => {
    render(<App />);

    // 8 brand + 4 derived + 6 surface + 5 text/rule + 9 accent/status.
    expect(screen.getAllByTestId('token-swatch')).toHaveLength(32);
  });
});
