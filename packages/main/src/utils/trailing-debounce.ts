/**
 * Trailing-edge debounce with explicit flush/cancel, for collapsing event
 * bursts (e.g. window resize/move) into a single side effect after the burst
 * ends. flush() exists so shutdown paths never lose the pending write.
 */

export interface TrailingDebounce {
  /** Schedule the fn to run `waitMs` after the most recent call. */
  call(): void;
  /** Run a pending invocation now (no-op when nothing is pending). */
  flush(): void;
  /** Drop a pending invocation without running it. */
  cancel(): void;
}

export function createTrailingDebounce(fn: () => void, waitMs: number): TrailingDebounce {
  if (waitMs <= 0) {
    throw new Error(`createTrailingDebounce: waitMs must be > 0, got ${waitMs}`);
  }

  let timer: NodeJS.Timeout | null = null;

  const run = () => {
    timer = null;
    fn();
  };

  return {
    call() {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(run, waitMs);
    },
    flush() {
      if (timer === null) {
        return;
      }
      clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
