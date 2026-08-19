import { afterEach, describe, expect, it, vi } from 'vitest';

import { notify } from '../state/diagnostics';
import { installToastNotifier } from './toaster';

/**
 * Task 4's nine stores already call `notify.*`, and until something installs a sink those calls
 * land on the console (`state/diagnostics.ts`). This is the sink, and the only thing worth
 * testing about it is that all four levels are actually routed — a missing one would silently
 * downgrade a user-facing message to a console line nobody sees.
 *
 * `sonner` is mocked rather than rendered because the assertion is about the routing, not about
 * sonner's stacking or timers. Rendering the real `<Toaster />` would test the library.
 */

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const { toast } = await import('sonner');

let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.clearAllMocks();
});

describe('installToastNotifier', () => {
  it('routes every level of the notifier seam', () => {
    uninstall = installToastNotifier();

    notify.success('Backup completed');
    notify.error('Login failed');
    notify.warning('pg_dump not found');
    notify.info('Connected');

    expect(toast.success).toHaveBeenCalledWith('Backup completed');
    expect(toast.error).toHaveBeenCalledWith('Login failed');
    expect(toast.warning).toHaveBeenCalledWith('pg_dump not found');
    expect(toast.info).toHaveBeenCalledWith('Connected');
  });

  it('returns a teardown that puts the previous sink back', () => {
    uninstall = installToastNotifier();
    notify.success('first');
    expect(toast.success).toHaveBeenCalledTimes(1);

    uninstall();
    uninstall = undefined;
    notify.success('second');

    // Back on the console sink, so sonner sees nothing more. Without this, an effect that
    // installs the notifier on mount would leak it on unmount.
    expect(toast.success).toHaveBeenCalledTimes(1);
  });
});
