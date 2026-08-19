/**
 * The database the sidebar is pointed at: the user's explicit pick, or — when they have not made
 * one — the same default `⌘N` would resolve.
 *
 * Both the picker's label and the footer's Backup action need this exact value, which is the only
 * reason it is a hook rather than two `useConnectionStore` calls.
 *
 * ── Why not just the explicit selection ─────────────────────────────────────────────────────
 *
 * `selectedDatabaseByConnection` is empty until the user opens the picker, so the Angular sidebar
 * read "Select Database" and disabled New Query and Backup on a freshly-connected server
 * (`sidebar.component.ts:178,305,323`) — even though `openQueryTab` would have happily used the
 * profile's configured default. Two affordances were dead, and the label was wrong: the query
 * tab a user opened right then DID target a database, just not the one the picker admitted to.
 *
 * `selectDefaultDatabaseFor` is the store's own three-stage resolution (last selection → the
 * profile's default, if it still exists → the first database the server returned), so this hook
 * adds no policy of its own; it names the value the rest of the app already acts on.
 */

import {
  selectDefaultDatabaseFor,
  useConnectionStore,
  type ConnectionStoreState,
} from '../../state/connection';

export function useResolvedDatabase(connectionId: string | null): string | null {
  // A primitive result, so no `useShallow` is needed — a new string only appears when the answer
  // actually changed.
  return useConnectionStore((state: ConnectionStoreState) =>
    connectionId === null ? null : selectDefaultDatabaseFor(connectionId)(state)
  );
}
