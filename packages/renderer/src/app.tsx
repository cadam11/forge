/**
 * Root.
 *
 * Task 7 takes the other side of the branch that has been here since Task 2: `AppShell` is now the
 * production root, and the two dev pages (the Task 2 token preview and the Task 6 primitives
 * gallery) are behind a hash. Both stay reachable in a DEV build — they are how the token and
 * primitive gates are screenshotted — but they are no longer what the renderer *is*.
 *
 * ── The DEV gate is still a build lever, not a preference ──────────────────────────────────
 *
 * `import.meta.env.DEV` is statically `false` in a production bundle, so every module reachable only
 * from `DevRoot` is dropped by dead-code elimination. That was measured at Task 6 (766KB → 526KB)
 * and the arrangement is unchanged; what changed is which branch ships. A dev build now needs an
 * explicit `#tokens` or `#primitives` to see a dev page, so `pnpm dev` shows the app.
 *
 * `IpcQueryProvider` stays at the root because TanStack Query's cache is app-wide; hoisting it later
 * would discard every cached result at the seam.
 */

import { useEffect, useState } from 'react';

import { DevRoot, isDevPageHash } from './dev/dev-root';
import { IpcQueryProvider } from './ipc';
import { AppShell } from './shell';
import { useNativeThemeSync } from './state/settings';

/**
 * The dev-page hash, tracked live so the gate scripts can navigate with `page.goto(BASE +
 * '#primitives')` and so a hash change swaps pages without a reload. Returns `false` in a production
 * build without reading `location` at all.
 */
function useDevPage(): boolean {
  const [isDevPage, setIsDevPage] = useState(
    () => import.meta.env.DEV && isDevPageHash(window.location.hash)
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onHashChange = (): void => setIsDevPage(isDevPageHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return isDevPage;
}

/**
 * The OS-theme listener, mounted at the root rather than inside the shell so it covers BOTH
 * branches: the dev pages have to paint the right canvas too, and since Task 7 deleted
 * `dev/use-preview-theme.ts` the settings store is the only thing that can write `[data-theme]`.
 *
 * A component rather than a hook call in `App`, because `useNativeThemeSync` reads through
 * `useIpcQuery` and therefore has to be INSIDE the provider `App` renders.
 */
function ThemeSync() {
  useNativeThemeSync();
  return null;
}

export function App() {
  const devPage = useDevPage();

  return (
    <IpcQueryProvider>
      <ThemeSync />
      {import.meta.env.DEV && devPage ? <DevRoot /> : <AppShell />}
    </IpcQueryProvider>
  );
}
