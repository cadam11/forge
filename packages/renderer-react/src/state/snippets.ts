/**
 * The snippet library's data, and the owner Task 5 named for it.
 *
 * `persistence/hydrate.ts` handed `snippets` back as a `HydratedRendererState` field with a
 * `// Task 16 (snippet library)` comment on it, because the surface that owns them did not exist
 * yet. This is that surface's store.
 *
 * ── The one thing this file must never do ───────────────────────────────────────────────────
 *
 * The whole library lived in the `joinery-snippets` browser-storage key and nowhere else (PLAN.md 0.5), and
 * Task 5's one-shot migration lifted it into main-process `AppState`. So this store **reads through
 * the hydrated state and writes through `rendererStatePersistence`**, and touches `localStorage`
 * nowhere — `persistence/no-local-storage-writes.spec.ts` permits exactly one `setItem` in this
 * package and it belongs to the theme mirror. Conventions and the write-gate reasoning:
 * `state/editor-prefs.ts`, which this store is deliberately shaped like.
 *
 * ── Why the writes are read-modify-write on the array ──────────────────────────────────────
 *
 * `rendererStatePersistence.update` hands the mutator the *persisted* sub-object, so a write could
 * be expressed as "append to whatever is on disk". It is expressed as "replace with what the store
 * now holds" instead, because the store is the thing the user is looking at: an append against a
 * disk value that a concurrent Angular session had also changed would produce a list neither
 * renderer displayed. The store is one writer with one in-memory truth, and `update()` serializes
 * itself, so last-writer-wins here means "the window the user typed in wins".
 */

import { create } from 'zustand';
// The leaf persistence module, never the `persistence/` barrel — see the note in that barrel.
import {
  rendererStatePersistence,
  type RendererStatePersistence,
  type SqlSnippet,
} from '../persistence/renderer-state';

export type { SqlSnippet };

/** What the library collects when the user saves one. `sql` and `name` are the two it insists on. */
export interface SnippetDraft {
  readonly name: string;
  readonly sql: string;
  readonly tags: readonly string[];
}

export interface SnippetsState {
  readonly snippets: readonly SqlSnippet[];
  /** Whether `hydrate` has run. Until it has, nothing may be persisted. */
  readonly hydrated: boolean;

  /** Adopts the persisted library. Called once, from the shell's startup path. */
  readonly hydrate: (snippets: readonly SqlSnippet[]) => void;

  /**
   * Saves a new snippet and returns its id. Newest last, which is the order the Angular library
   * persisted (`[...allSnippets(), snippet]`) and therefore the order existing data is in.
   */
  readonly createSnippet: (draft: SnippetDraft) => string;
  /** Edits one. A field left out of the patch is left alone. No-op for an unknown id. */
  readonly updateSnippet: (id: string, patch: Partial<SnippetDraft>) => void;
  /** Deletes one. No-op for an unknown id — and no write, so a stray delete cannot touch disk. */
  readonly deleteSnippet: (id: string) => void;
}

export type SnippetsStore = ReturnType<typeof createSnippetsStore>;

/**
 * A fresh id. `crypto.randomUUID` rather than the Angular
 * `snippet-${Date.now()}-${Math.random().toString(36)}`: two snippets saved in the same millisecond
 * from two windows could collide there, and an id collision in a keyed list is a snippet that
 * silently overwrites another. Available in Electron's renderer and in jsdom.
 */
function newSnippetId(): string {
  return `snippet-${crypto.randomUUID()}`;
}

/** Tags, trimmed and de-duplicated, in the order they were given. */
function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    kept.push(trimmed);
  }
  return kept;
}

export function createSnippetsStore(
  persistence: RendererStatePersistence = rendererStatePersistence
) {
  return create<SnippetsState>()((set, get) => {
    /**
     * Persists the list the store now holds. Fire-and-forget, like every other renderer-state
     * write: a dialog must not wait on IPC to close, and `update()` reports its own failures.
     */
    const persist = (snippets: readonly SqlSnippet[]): void => {
      if (!get().hydrated) return;
      void persistence.update(current => ({ ...current, snippets: [...snippets] }));
    };

    return {
      snippets: [],
      hydrated: false,

      hydrate: snippets => set({ snippets: [...snippets], hydrated: true }),

      createSnippet: draft => {
        const snippet: SqlSnippet = {
          id: newSnippetId(),
          name: draft.name.trim(),
          sql: draft.sql,
          tags: normalizeTags(draft.tags),
          createdAt: new Date().toISOString(),
        };
        const snippets = [...get().snippets, snippet];
        set({ snippets });
        persist(snippets);
        return snippet.id;
      },

      updateSnippet: (id, patch) => {
        const current = get().snippets;
        if (!current.some(snippet => snippet.id === id)) return;
        const snippets = current.map(snippet =>
          snippet.id === id
            ? {
                ...snippet,
                ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
                ...(patch.sql === undefined ? {} : { sql: patch.sql }),
                ...(patch.tags === undefined ? {} : { tags: normalizeTags(patch.tags) }),
              }
            : snippet
        );
        set({ snippets });
        persist(snippets);
      },

      deleteSnippet: id => {
        const current = get().snippets;
        if (!current.some(snippet => snippet.id === id)) return;
        const snippets = current.filter(snippet => snippet.id !== id);
        set({ snippets });
        persist(snippets);
      },
    };
  });
}

export const snippetsStore = createSnippetsStore();
export const useSnippetsStore = snippetsStore;

export function selectSnippets(state: Pick<SnippetsState, 'snippets'>): readonly SqlSnippet[] {
  return state.snippets;
}

export function selectSnippetCount(state: Pick<SnippetsState, 'snippets'>): number {
  return state.snippets.length;
}
