/**
 * The TanStack Query host. Every `window.joinery` request/response call is an async request
 * with cache, invalidate and retry semantics, which is exactly the job the Angular
 * renderer's `ipc.service.ts` hand-rolled out of RxJS and `NgZone` (PLAN.md §2).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Defaults tuned for a local IPC channel rather than for a network, which is where every
 * one of TanStack's stock defaults comes from:
 *
 * - `retry: false`. A rejected `invoke` is a real answer from the main process — a SQL
 *   syntax error, a dead connection, a missing `pg_dump`. Retrying it three times delays
 *   the error the user needs to see and, for anything non-idempotent, is actively wrong.
 *   The transient-network failure that `retry: 3` exists for cannot happen over a pipe.
 * - `refetchOnWindowFocus: false`. A desktop window loses and regains focus constantly.
 *   Re-running every mounted explorer and metadata query on each alt-tab would hammer the
 *   user's database for no benefit.
 * - `staleTime: 30_000`. Database metadata does not change under us on a second-by-second
 *   basis, and 30s of freshness collapses the burst of duplicate reads that happens when a
 *   tree node, a properties panel and a query editor all mount against the same table.
 *   Anything that *does* change it is a write we made ourselves, and writes invalidate
 *   explicitly through `ipcKeys` — correctness comes from invalidation here, not from the
 *   clock, so this number is a performance knob rather than a staleness risk.
 */
export function createIpcQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * `useState` rather than a module-level client: a module singleton is shared by every test
 * in a file, so one test's cached results leak into the next. Passing the factory (not a
 * call) means StrictMode's double render still ends up with one client.
 */
export function IpcQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createIpcQueryClient);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
