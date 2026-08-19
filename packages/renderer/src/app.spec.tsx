/**
 * The root's one job: choose between the app and the two dev pages.
 *
 * Until Task 7 this file was the package's smoke test and asserted that `<App />` rendered the token
 * preview, because the token preview WAS the renderer. Task 7 inverts that — the shell is the
 * production root and the dev pages moved behind a hash — so the assertions move with it. What the
 * dev pages themselves render is covered by their own browser gates (`task-2-gate.mjs`,
 * `task-6-gate.mjs`), which is where a page of swatches can actually be measured; re-asserting their
 * contents here only duplicated a screenshot's job.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { App } from './app';
import { bootStore, resetBootLatch } from './shell';
import { settingsStore } from './state/settings';

beforeEach(() => {
  window.localStorage.clear();
  settingsStore.getState().updateTheme('system');
  document.documentElement.removeAttribute('data-theme');
  window.location.hash = '';
  resetBootLatch();
  bootStore.getState().reset();
});

afterEach(() => {
  window.location.hash = '';
  resetBootLatch();
  bootStore.getState().reset();
});

describe('App', () => {
  it('renders the app, not a dev page', async () => {
    render(<App />);

    // The startup screen first — the boot gate — and then the shell. Neither dev page is reachable
    // without asking for it.
    expect(screen.getByTestId('startup-screen')).toBeDefined();
    expect(await screen.findByTestId('app-shell')).toBeDefined();
    expect(screen.queryByTestId('renderer-root')).toBeNull();
    expect(screen.queryByTestId('primitives-gallery')).toBeNull();
  });

  it('renders the token preview at #tokens, which is how its gate reaches it', () => {
    window.location.hash = '#tokens';

    render(<App />);

    expect(screen.getByTestId('renderer-root')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Theme preview');
    expect(screen.queryByTestId('app-shell')).toBeNull();
  });

  it('renders one swatch per registered colour token, at #tokens', () => {
    // Kept from before Task 7 rather than retired with the rest of the token-page assertions: this
    // one is not a screenshot's job. It is the only check that the token TABLE and the CSS layer have
    // the same number of colours in them, and it caught nothing by accident — a token added to
    // `tokens.css` and not to the preview's list (or the reverse) changes this count. It moves behind
    // the `#tokens` hash because the dev page is no longer the root.
    window.location.hash = '#tokens';

    render(<App />);

    // 8 brand + 4 derived + 6 surface + 5 text/rule + 9 accent/status.
    expect(within(screen.getByTestId('renderer-root')).getAllByTestId('token-swatch')).toHaveLength(
      32
    );
  });

  it('renders the primitives gallery at #primitives', () => {
    window.location.hash = '#primitives';

    render(<App />);

    expect(screen.getByTestId('primitives-gallery')).toBeDefined();
  });

  it('treats an unrecognised hash as the app', () => {
    window.location.hash = '#nonsense';

    render(<App />);

    expect(screen.getByTestId('startup-screen')).toBeDefined();
  });

  it('applies the settings store’s theme to <html> on mount, on a dev page as well as the app', () => {
    // `useNativeThemeSync` sits at the ROOT rather than in the shell precisely so this holds for both
    // branches — the dev pages have to paint the right canvas too, and since Task 7 deleted
    // `dev/use-preview-theme.ts` the settings store is the only thing that may write the attribute.
    //
    // Driven through the store rather than through localStorage: the store is a module singleton
    // constructed at import time, so it read the mirror long before this test could seed it. Where
    // the initial preference COMES from — the mirror, then the Angular settings object — is covered
    // by `state/settings.spec.tsx`, which builds fresh stores for exactly that reason.
    settingsStore.getState().updateTheme('light');
    window.location.hash = '#tokens';

    render(<App />);

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('theme-light').getAttribute('aria-pressed')).toBe('true');

    settingsStore.getState().updateTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reports browser mode from the IPC probe when preload never ran', () => {
    // No window.joinery in jsdom, which is the same state as opening :4200 in a browser. The page
    // renders the guard's answer instead of throwing on the way to the bridge.
    window.location.hash = '#tokens';

    render(<App />);

    expect(screen.getByTestId('ipc-probe-available').textContent).toBe('browser mode');
    expect(screen.getByTestId('ipc-probe-version').textContent).toBe('not called');
  });
});
