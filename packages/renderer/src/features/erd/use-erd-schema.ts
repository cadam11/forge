/**
 * Loading a diagram: the four states a schema read can be in, and one cancellable effect.
 *
 * ── Not `useIpcQuery` ──────────────────────────────────────────────────────────────────────────
 *
 * That hook is one bridge operation to one cached query, and a diagram is 2N operations composed by
 * `buildErd` — there is no single call to key. Its sibling rule (`eslint.config.js`) also bars
 * anything outside `src/ipc/` from naming `ipcKeys`, so a bespoke TanStack query here could not build
 * a key in the same namespace as the reads it makes. A plain effect with a generation guard is the
 * honest shape, and the caching a query would have given is in `erd-cache.ts`, where its bound is
 * visible.
 *
 * ── Why nothing is set synchronously in the effect ─────────────────────────────────────────────
 *
 * Two of the four states are knowable during render — no request means idle, a cached diagram means
 * ready — and only a real fetch needs the effect. Setting those two from the effect is a cascading
 * render, which `react-hooks/set-state-in-effect` rejects, so they are DERIVED instead: `resolveState`
 * answers the question during render, and the effect's stored result carries the request it belongs to
 * (`key`, `attempt`), exactly as `features/query/row-detail-panel.tsx` carries the row an interaction
 * was recorded against.
 *
 * There is deliberately no `isIpcAvailable()` branch. Running outside Electron is not a fifth state:
 * `ipcSchemaReader`'s first call throws `IpcUnavailableError`, which lands in the `catch` below and
 * becomes the same error state as a rejected query, with a message that already says exactly that. One
 * error path, and a reader a spec can inject without also having to install a bridge.
 *
 * `resolveState` reads the module-level cache during render, which is a read of external state. It is
 * safe here and only here: the cache changes in exactly one place — the `.then` below, which is
 * immediately followed by a `setResult`, so a change is always accompanied by a re-render. There is
 * no writer this hook cannot see.
 *
 * **Both parameters must be referentially stable.** `request` comes out of a `useMemo` in
 * `erd-panel.tsx`; `reader` defaults to a module function and is only ever passed by specs.
 */

import { useCallback, useEffect, useState } from 'react';

import { diagnostics } from '../../state/diagnostics';
import { buildErd, type ErdRequest, type SchemaReader } from './erd-adapter';
import { cachedErd, erdCacheKey, forgetErd, rememberErd } from './erd-cache';
import type { ErdNode } from './erd-model';
import { ipcSchemaReader } from './erd-schema-reader';

export type ErdSchemaState =
  /** No connection or no database — the tab cannot name a diagram yet. */
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly nodes: readonly ErdNode[];
      /** `MAX_ERD_TABLES` stopped the build short. The panel says so. */
      readonly truncated: boolean;
    }
  | { readonly status: 'error'; readonly message: string };

export interface ErdSchema {
  readonly state: ErdSchemaState;
  /** Drops this diagram from the cache and rebuilds it. The toolbar's Refresh. */
  readonly reload: () => void;
}

const IDLE: ErdSchemaState = { status: 'idle' };
const LOADING: ErdSchemaState = { status: 'loading' };

/** What the effect resolved, and which request-and-attempt it resolved it for. */
interface ResolvedSchema {
  readonly key: string;
  readonly attempt: number;
  readonly state: ErdSchemaState;
}

export function useErdSchema(
  request: ErdRequest | null,
  reader: () => SchemaReader = ipcSchemaReader
): ErdSchema {
  /** Bumped by `reload`, and part of both the effect's dependencies and the result's identity. */
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<ResolvedSchema | null>(null);

  const state = resolveState(request, attempt, resolved);

  useEffect(() => {
    // The two synchronous answers are already rendered by `resolveState`; only a real fetch is left.
    if (request === null) return;
    const key = erdCacheKey(request);
    if (cachedErd(key) !== undefined) return;

    let cancelled = false;

    buildErd(reader(), request)
      .then(result => {
        if (cancelled) return;
        rememberErd(key, result);
        setResolved({
          key,
          attempt,
          state: { status: 'ready', nodes: result.nodes, truncated: result.truncated },
        });
      })
      .catch((cause: unknown) => {
        // Never swallowed: logged with its cause and surfaced in the panel. No toast — the panel is
        // visible and says the same thing, and the Angular version's `notification.error` on top of
        // its own error state reported one failure twice.
        diagnostics.error('failed to build an ERD', cause);
        if (cancelled) return;
        setResolved({
          key,
          attempt,
          state: {
            status: 'error',
            message: cause instanceof Error ? cause.message : 'Failed to read the schema.',
          },
        });
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, reader, request]);

  const reload = useCallback(() => {
    if (request !== null) forgetErd(erdCacheKey(request));
    setAttempt(current => current + 1);
  }, [request]);

  return { state, reload };
}

/**
 * The state to render, in precedence order. Pure but for the cache read — see the module header.
 *
 * A stored result only counts for the request AND the attempt it was fetched for, which is what makes
 * a tab repointed at another table show `loading` rather than the previous table's diagram, with no
 * reset effect anywhere.
 */
function resolveState(
  request: ErdRequest | null,
  attempt: number,
  resolved: ResolvedSchema | null
): ErdSchemaState {
  if (request === null) return IDLE;

  const key = erdCacheKey(request);
  const cached = cachedErd(key);
  if (cached !== undefined) {
    return { status: 'ready', nodes: cached.nodes, truncated: cached.truncated };
  }

  if (resolved !== null && resolved.key === key && resolved.attempt === attempt) {
    return resolved.state;
  }

  return LOADING;
}
