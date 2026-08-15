/**
 * The two output ports the ported stores need, and which nothing else in the renderer owns
 * yet.
 *
 * The Angular states wrote to two collaborators this task does not port: `NotificationService`
 * (88 LOC over `MatSnackBar`) for user-facing messages, and bare `console.error` for developer
 * diagnostics. Both are scheduled — `sonner` in Task 7, the ported `log.service` in Task 7 —
 * and a store cannot wait for them, so each is a one-method-per-level port with a swappable
 * sink instead of a hard dependency on a toast library that does not exist yet.
 *
 * Two module-level singletons, which is the one place this package has them. The Angular
 * originals were `providedIn: 'root'` services — a process-wide singleton reached from
 * anywhere — so this is the faithful shape rather than a shortcut, and threading a notifier
 * parameter through nine stores to reach the same effect would be ceremony that hides the
 * call sites rather than surfacing them. Tests install a recording sink; Task 7 installs the
 * real ones from the shell's mount.
 */

export interface Notifier {
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
  warning(message: string): void;
}

/**
 * Developer-facing diagnostics. `cause` is deliberately `unknown` — a rejected IPC call can
 * reject with anything — and every ported `catch` block routes here, so no error is swallowed
 * even while the real log service is a task away.
 */
export interface DiagnosticsSink {
  error(context: string, cause: unknown): void;
  warn(context: string, cause: unknown): void;
}

/* eslint-disable no-console -- The default sinks ARE the console. This is the only block in
   the package allowed to say so; everything else goes through `notify` / `diagnostics`, which
   is what lets Task 7 redirect the lot in two calls. */
const consoleDiagnostics: DiagnosticsSink = {
  error: (context, cause) => console.error(`[joinery] ${context}`, cause),
  warn: (context, cause) => console.warn(`[joinery] ${context}`, cause),
};

const consoleNotifier: Notifier = {
  success: message => console.info(`[joinery] ${message}`),
  error: message => console.error(`[joinery] ${message}`),
  info: message => console.info(`[joinery] ${message}`),
  warning: message => console.warn(`[joinery] ${message}`),
};
/* eslint-enable no-console */

let activeNotifier: Notifier = consoleNotifier;
let activeDiagnostics: DiagnosticsSink = consoleDiagnostics;

/** Returns the teardown that puts the previous notifier back — tests rely on it. */
export function setNotifier(next: Notifier): () => void {
  const previous = activeNotifier;
  activeNotifier = next;
  return () => {
    activeNotifier = previous;
  };
}

/** Returns the teardown that puts the previous sink back. */
export function setDiagnosticsSink(next: DiagnosticsSink): () => void {
  const previous = activeDiagnostics;
  activeDiagnostics = next;
  return () => {
    activeDiagnostics = previous;
  };
}

/**
 * Delegating façades rather than `getNotifier().error(…)` at 40 call sites. They read the
 * `let` on every call, so installing a sink takes effect immediately and no store can capture
 * a stale reference at module-init time.
 */
export const notify: Notifier = {
  success: message => activeNotifier.success(message),
  error: message => activeNotifier.error(message),
  info: message => activeNotifier.info(message),
  warning: message => activeNotifier.warning(message),
};

export const diagnostics: DiagnosticsSink = {
  error: (context, cause) => activeDiagnostics.error(context, cause),
  warn: (context, cause) => activeDiagnostics.warn(context, cause),
};
