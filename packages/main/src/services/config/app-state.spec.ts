import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStateStore } from './app-state';

/** Fresh instance simulating a new process: sees only persisted data. */
function freshInstance(): AppStateStore {
  AppStateStore.resetInstance();
  return AppStateStore.getInstance();
}

describe('AppStateStore (debounced persistence)', () => {
  let store: AppStateStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = freshInstance();
    store.clearState();
    store.flush();
  });

  afterEach(() => {
    AppStateStore.getInstance().flush();
    vi.useRealTimers();
  });

  it('setState is visible immediately through getState()', () => {
    store.setState({ lastDatabase: 'db-x', sidebarWidth: 300 });
    expect(store.getState().lastDatabase).toBe('db-x');
    expect(store.getState().sidebarWidth).toBe(300);
  });

  it('consecutive setState calls collapse into one deferred persist', () => {
    store.setOpenTabs([]);
    store.setActiveTabId('tab-9');

    // Nothing persisted yet…
    expect(freshInstance().getState().activeTabId).toBeNull();

    // …but the debounced write carries both mutations. Re-apply on the live
    // instance (freshInstance above replaced the singleton, discarding the
    // unpersisted cache — exactly what a crash would do).
    const live = freshInstance();
    live.setOpenTabs([]);
    live.setActiveTabId('tab-9');
    vi.advanceTimersByTime(1000);

    const fresh = freshInstance();
    expect(fresh.getState().activeTabId).toBe('tab-9');
    expect(fresh.getState().openTabs).toEqual([]);
  });

  it('flush() persists immediately (quit path)', () => {
    store.setLastDatabase('quit-db');
    store.flush();

    expect(freshInstance().getState().lastDatabase).toBe('quit-db');
  });

  it('getState returns a copy — callers cannot mutate the cache', () => {
    const a = store.getState();
    a.lastDatabase = 'mutated';
    expect(store.getState().lastDatabase).not.toBe('mutated');
  });
});
