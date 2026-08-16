/**
 * The two migrated query-editor preferences: the hydration gate, and the merge that keeps one query's
 * placeholder answers from erasing another's.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RendererStatePersistence, ReactRendererState } from '../persistence/renderer-state';
import { createEditorPrefsStore, selectConfirmedCtrlEExecute } from './editor-prefs';

/** A persistence double that records what was written and replays it to the next mutator. */
function fakePersistence(initial: ReactRendererState = {}) {
  let current: ReactRendererState = initial;
  const update = vi.fn(async (mutate: Parameters<RendererStatePersistence['update']>[0]) => {
    const next = mutate(current);
    if (next === undefined) return 'unchanged' as const;
    current = next;
    return 'written' as const;
  });
  return {
    persistence: { read: async () => current, update } as RendererStatePersistence,
    update,
    get state() {
      return current;
    },
  };
}

describe('hydration', () => {
  it('adopts both persisted values', () => {
    const store = createEditorPrefsStore(fakePersistence().persistence);
    store.getState().hydrate({
      confirmedCtrlEExecute: true,
      flywayPlaceholderValues: { schema: 'public' },
    });

    expect(selectConfirmedCtrlEExecute(store.getState())).toBe(true);
    expect(store.getState().flywayPlaceholderValues).toEqual({ schema: 'public' });
    expect(store.getState().hydrated).toBe(true);
  });

  it('defaults to "the gate has not been dismissed", which is the safe direction', () => {
    const store = createEditorPrefsStore(fakePersistence().persistence);
    expect(selectConfirmedCtrlEExecute(store.getState())).toBe(false);
    expect(store.getState().flywayPlaceholderValues).toEqual({});
  });

  it('refuses to persist before hydration, so a default cannot overwrite a real value', () => {
    // The same gate `state/settings.ts` has, for the same reason: the value on disk may be `true`, and a
    // pre-hydration write of the default `false` would lose it permanently.
    const fake = fakePersistence({ confirmedCtrlEExecute: true });
    const store = createEditorPrefsStore(fake.persistence);

    store.getState().confirmCtrlEExecute();

    expect(fake.update).not.toHaveBeenCalled();
    // The change is still live in the session — it is only the write that is withheld.
    expect(selectConfirmedCtrlEExecute(store.getState())).toBe(true);
  });
});

describe('confirmCtrlEExecute', () => {
  it('persists the tick once', async () => {
    const fake = fakePersistence();
    const store = createEditorPrefsStore(fake.persistence);
    store.getState().hydrate({ confirmedCtrlEExecute: false, flywayPlaceholderValues: {} });

    store.getState().confirmCtrlEExecute();
    await vi.waitFor(() => expect(fake.state.confirmedCtrlEExecute).toBe(true));

    // Idempotent: a second call short-circuits rather than queueing another write.
    store.getState().confirmCtrlEExecute();
    expect(fake.update).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the persisted value already says true', async () => {
    const fake = fakePersistence({ confirmedCtrlEExecute: true });
    const store = createEditorPrefsStore(fake.persistence);
    // Hydrated as false even though disk says true — the case where two windows disagree.
    store.getState().hydrate({ confirmedCtrlEExecute: false, flywayPlaceholderValues: {} });

    store.getState().confirmCtrlEExecute();

    await vi.waitFor(() => expect(fake.update).toHaveBeenCalledTimes(1));
    expect(await fake.update.mock.results[0]?.value).toBe('unchanged');
  });
});

/*
 * The way back, which Task 15's settings panel is the only caller of. The ⌃E dialog can only ever set the
 * flag, so without this the user's "don't ask me again" was permanent — and a settings control for it
 * would have been decorative if the store had no action to call.
 */
describe('resetCtrlEExecuteConfirmation', () => {
  it('persists the reset, so the gate is back on the next launch too', async () => {
    const fake = fakePersistence({ confirmedCtrlEExecute: true });
    const store = createEditorPrefsStore(fake.persistence);
    store.getState().hydrate({ confirmedCtrlEExecute: true, flywayPlaceholderValues: {} });

    store.getState().resetCtrlEExecuteConfirmation();

    expect(selectConfirmedCtrlEExecute(store.getState())).toBe(false);
    await vi.waitFor(() => expect(fake.state.confirmedCtrlEExecute).toBe(false));
  });

  it('writes nothing when there was nothing to reset', () => {
    const fake = fakePersistence();
    const store = createEditorPrefsStore(fake.persistence);
    store.getState().hydrate({ confirmedCtrlEExecute: false, flywayPlaceholderValues: {} });

    store.getState().resetCtrlEExecuteConfirmation();

    // Which is what lets the panel DISABLE the button rather than offering a press that does nothing.
    expect(fake.update).not.toHaveBeenCalled();
  });
});

describe('rememberPlaceholderValues', () => {
  it('merges over what was remembered rather than replacing it', async () => {
    const fake = fakePersistence();
    const store = createEditorPrefsStore(fake.persistence);
    store.getState().hydrate({
      confirmedCtrlEExecute: false,
      flywayPlaceholderValues: { schema: 'public', owner: 'joinery' },
    });

    store.getState().rememberPlaceholderValues({ schema: 'reporting' });

    // `owner` came from a different query and must survive.
    expect(store.getState().flywayPlaceholderValues).toEqual({
      schema: 'reporting',
      owner: 'joinery',
    });
    await vi.waitFor(() =>
      expect(fake.state.flywayPlaceholderValues).toEqual({ schema: 'reporting', owner: 'joinery' })
    );
  });

  it('keeps an empty answer, because a placeholder may legitimately be blank', async () => {
    const fake = fakePersistence();
    const store = createEditorPrefsStore(fake.persistence);
    store.getState().hydrate({ confirmedCtrlEExecute: false, flywayPlaceholderValues: {} });

    store.getState().rememberPlaceholderValues({ suffix: '' });

    expect(store.getState().flywayPlaceholderValues).toEqual({ suffix: '' });
    await vi.waitFor(() => expect(fake.update).toHaveBeenCalledTimes(1));
  });
});
