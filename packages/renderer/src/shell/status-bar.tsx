/**
 * The status bar. A restructure, not a port — the audit's §1.9 findings about it are box-model bugs,
 * and porting the markup would port the bugs.
 *
 * What was wrong, and what is done instead:
 *
 *  1. **"The status bar cannot fit its own contents."** It was 24px tall with four 24px-tall controls
 *     inside it and a host-bound `border-top: 3px solid <profile.color>` eating another three, so the
 *     content box was 21px. Here the bar is **28px** (`h-7`, a spacing-ladder rung) with 20px
 *     controls, which leaves 4px of breathing room; the hairline is 1px like every other rule in the
 *     shell; and the connection colour is an **absolutely positioned 2px strip**, so it paints over
 *     the top edge instead of taking part in the box model. A profile colour can never again change
 *     how much room the controls have.
 *  2. **The unseen-error badge sat at `top: -2px`, outside the bar, and clipped.** It is now a
 *     tabular-nums count *inside* the button, beside the glyph. Nothing overflows, so nothing clips,
 *     and the number is legible at 11px in a way a 9px badge never was.
 *  3. **`.theme-toggle` lacked the `border`/`background` reset its three siblings had**, so it
 *     rendered with UA chrome. Every control here shares one class constant; there is no per-button
 *     styling to forget.
 *  4. **None of the four had `:focus-visible`.** That constant carries it, so the omission is not
 *     available.
 *
 * ── Nothing here is a placeholder any more ────────────────────────────────────────────────
 *
 * The connection segment reads the real stores, so *disconnected*, *connecting* and — since Task 10 —
 * *executing* are all live. The **Docker pip** was the last gap Task 7 recorded rather than faked, and
 * Task 19b closes it: `features/docker/DockerPip` is the trigger, its popover is the panel, and both read
 * one `useDocker()` so the count in the bar and the list in the panel cannot disagree. The bar owns only
 * the OPEN flag, because that is the one piece of state a `<Popover>` needs from its surroundings.
 *
 * The executing indicator reads `queryExecutionStore`, which Task 10 made the single source of truth for
 * "is a query running" — the same store the query toolbar's spinner and disabled states read. Task 7
 * deliberately shipped no indicator rather than inventing a second one to reconcile later.
 */

import { useState, type ReactNode } from 'react';
import {
  Cloud,
  CloudOff,
  Hourglass,
  Monitor,
  Moon,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Sun,
  Terminal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ThemePreference } from '@joinery/shared';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Icon,
  Tooltip,
  cn,
} from '../ui';
import { useCommand } from '../commands';
import {
  selectHasAnyConnection,
  selectHealthFor,
  selectProfileFor,
  selectSelectedDatabaseFor,
  useConnectionStore,
  useMostRecentConnectionId,
} from '../state/connection';
import { chatPanelStore, useChatPanelStore } from '../state/chat';
import {
  selectAnyExecuting,
  selectRunningCount,
  useQueryExecutionStore,
} from '../state/query-execution';
import { diagnostics } from '../state/diagnostics';
import { useKeychainDegraded } from '../state/keychain';
import { logStore, selectErrorCount, useLogStore } from '../state/logs';
import { selectTabCount, useTabStore } from '../state/tab';
import { settingsStore, selectTheme, useSettingsStore } from '../state/settings';
import { ipc, isIpcAvailable, useIpcQuery } from '../ipc';
import { DockerPip } from '../features/docker';

/**
 * The one control shape in the bar. 20px square (`size-5`) inside a 28px bar, with the resets and
 * the focus ring the audit found four controls missing.
 */
const CONTROL_CLASSES = cn(
  'flex h-5 shrink-0 items-center gap-1 rounded-xs border-0 bg-transparent px-1',
  'text-xs text-fg-muted hover:bg-hover hover:text-fg',
  'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus',
  'aria-pressed:text-accent'
);

/** A read-only segment: an icon and a value, never interactive, so no hover affordance. */
function Segment({
  testId,
  children,
  className,
}: {
  readonly testId: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn('flex min-w-0 shrink items-center gap-1 text-xs text-fg-muted', className)}
    >
      {children}
    </div>
  );
}

/**
 * A `Record` over the whole `ThemePreference` union rather than an array of options: the trigger has
 * to render the CURRENT preference's glyph, and an array lookup is `T | undefined` under
 * `noUncheckedIndexedAccess` — a fallback branch for a state the type says cannot happen. This way
 * the lookup is total, and adding a fourth preference to `settings.types.ts` fails to compile here.
 *
 * The labels are **Ivory** and **Ink**, not Light and Dark: those are the names HOUSE-RULES §3 and
 * `docs/brand/` give the two canvases, and Task 15's settings panel uses them. Two names for one theme
 * across two controls in the same window is how a user learns the app is inconsistent, so
 * `features/settings`' spec asserts these labels against the panel's own `THEME_CHOICES` — which is why
 * this constant is exported.
 */
export const THEME_OPTIONS: Record<
  ThemePreference,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  system: { label: 'System', icon: Monitor },
  light: { label: 'Ivory', icon: Sun },
  dark: { label: 'Ink', icon: Moon },
};

const THEME_ORDER: readonly ThemePreference[] = ['system', 'light', 'dark'];

function ThemeMenu() {
  const preference = useSettingsStore(selectTheme);
  const current = THEME_OPTIONS[preference];

  return (
    <DropdownMenu>
      <Tooltip content={`Theme: ${current.label}`}>
        <DropdownMenuTrigger
          aria-label={`Theme: ${current.label}`}
          data-testid="status-theme-trigger"
          className={CONTROL_CLASSES}
        >
          <Icon icon={current.icon} size="sm" />
        </DropdownMenuTrigger>
      </Tooltip>
      {/* Checkbox items rather than plain ones: the three states are mutually exclusive AND the
          current one has to be visible, which is what the indicator is for. The Angular version
          drew its own trailing check glyph inside a plain item. */}
      <DropdownMenuContent align="end" side="top" data-testid="status-theme-menu">
        {THEME_ORDER.map(value => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={value === preference}
            data-testid={`status-theme-${value}`}
            onSelect={() => settingsStore.getState().updateTheme(value)}
          >
            {THEME_OPTIONS[value].label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The connection segment. Anchors on the most-recently-used connection rather than strictly on the
 * focused tab, which is the Angular behaviour and the right one: after a fresh connect there is no
 * query tab yet, and on the Welcome tab there is no focus at all — in both cases blanking the bar
 * would be less informative than showing what the user just connected to.
 */
/**
 * The running-query indicator, ported from `status-bar.component.ts:78-92`.
 *
 * It replaces the connection segment while a query is in flight, which is what the Angular `@else if`
 * chain did — the bar is 28px and cannot show both, and "a query is running" is the more urgent fact.
 * The count only appears above one, also as before: "Executing…" for one query, "Executing (3)…" for
 * three.
 */
function ExecutingSegment() {
  const runningCount = useQueryExecutionStore(selectRunningCount);
  return (
    <Segment testId="status-executing" className="text-accent">
      <Icon icon={Hourglass} size="sm" className="animate-pulse stroke-accent" />
      {/* No tooltip, unlike the Angular original's `matTooltip="Running N queries"`: `Segment` is a
          non-interactive div, so a tooltip on it would be reachable by hover and by nothing else. The
          count is in the label instead, which every user gets. */}
      <span>Executing{runningCount > 1 ? ` (${runningCount})` : ''}…</span>
    </Segment>
  );
}

function ConnectionSegment() {
  const connectionId = useMostRecentConnectionId();
  const hasAnyConnection = useConnectionStore(selectHasAnyConnection);
  const connecting = useConnectionStore(state => state.connecting);
  const profile = useConnectionStore(selectProfileFor(connectionId));
  const database = useConnectionStore(selectSelectedDatabaseFor(connectionId));
  const healthy = useConnectionStore(selectHealthFor(connectionId));
  const executing = useQueryExecutionStore(selectAnyExecuting);

  // Ordered as the Angular chain was: connecting, then executing, then the connection itself.
  if (!connecting && executing) return <ExecutingSegment />;

  if (connecting) {
    return (
      <Segment testId="status-connection">
        <Icon icon={RefreshCw} size="sm" className="animate-spin stroke-fg-muted" />
        <span>Connecting…</span>
      </Segment>
    );
  }

  if (!hasAnyConnection || !profile) {
    return (
      <Segment testId="status-connection">
        <Icon icon={CloudOff} size="sm" label="Not connected" className="stroke-fg-muted" />
        <span>Not connected</span>
      </Segment>
    );
  }

  return (
    <>
      <Segment testId="status-connection">
        <Icon
          icon={healthy ? Cloud : CloudOff}
          size="sm"
          label={healthy ? 'Connected' : 'Connection lost — reconnecting'}
          className={healthy ? 'stroke-success' : 'stroke-warning'}
        />
        <span className="truncate">{profile.name}</span>
        {healthy ? null : (
          <Icon icon={RefreshCw} size="sm" className="animate-spin stroke-warning" />
        )}
      </Segment>
      {database === null ? null : (
        <Segment testId="status-database">
          <span className="font-mono text-xs truncate">{database}</span>
        </Segment>
      )}
    </>
  );
}

/** The page that explains what happened and how to fix it. Opened in the host browser. */
const KEYCHAIN_HELP_URL = 'https://usejoinery.com/troubleshooting/credentials-and-keychain/';

/**
 * The keychain-degraded indicator (J-118).
 *
 * Rendered only while the credential store is refusing — there is no "keychain fine" state in
 * the bar, because a permanently lit reassurance is a permanently ignored one. Until this
 * existed, the only trace of the failure was a `CredentialStore` line in the output panel, and
 * the user's version of the story was "my passwords keep disappearing".
 *
 * A `<button>` rather than a `Segment`: the copy that matters is in the tooltip, and a tooltip
 * on a non-interactive div is reachable by hover and by nothing else. The button carries the
 * same sentence as its `aria-label`, so a screen reader gets it without hovering, and pressing
 * it opens the troubleshooting page through `app.openExternal` — never as an in-window
 * navigation (see `welcome-panel.tsx` for why the app has no `<a href>` to the outside).
 */
function KeychainIndicator() {
  const degraded = useKeychainDegraded();

  if (!degraded) return null;

  const openHelp = (): void => {
    if (!isIpcAvailable()) return;
    void ipc()
      .app.openExternal(KEYCHAIN_HELP_URL)
      .catch(error => diagnostics.error('failed to open the keychain troubleshooting page', error));
  };

  return (
    <Tooltip content="Passwords won't be saved this session — the keychain refused access. Open the troubleshooting guide.">
      <button
        type="button"
        aria-label="Keychain unavailable — passwords will not be saved this session. Open the troubleshooting guide."
        data-testid="status-keychain"
        onClick={openHelp}
        className={cn(CONTROL_CLASSES, 'text-warning hover:text-warning')}
      >
        <Icon icon={ShieldAlert} size="sm" className="stroke-warning" />
        <span>Keychain unavailable</span>
      </button>
    </Tooltip>
  );
}

export function StatusBar() {
  const connectionId = useMostRecentConnectionId();
  const profile = useConnectionStore(selectProfileFor(connectionId));
  const tabCount = useTabStore(selectTabCount);
  const outputOpen = useLogStore(state => state.isOpen);
  const unseenErrors = useLogStore(state => state.unseenErrors);
  const errorCount = useLogStore(selectErrorCount);
  const chatOpen = useChatPanelStore(state => state.panelOpen);

  // The one thing in the bar that is a request rather than store state.
  const version = useIpcQuery({
    namespace: 'app',
    operation: 'getVersion',
    enabled: isIpcAvailable(),
  });

  /**
   * Ln/Col. The `cursor-position` command's registered consumer is this bar (`COMMAND_CONSUMERS`),
   * and its producer is Task 10's editor — so it reads zero until then, and the segment hides
   * itself, exactly as the Angular original did (`status-bar.component.ts:188`).
   */
  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null);
  useCommand('cursor-position', payload => setCursor(payload));

  /**
   * Whether the Docker popover is up. Here rather than inside `DockerPip` for one reason: Radix's
   * `Popover` is controlled from outside when anything other than its own trigger can open it, and the
   * palette can (`open-docker-panel`). The pip subscribes to that command itself — see its header.
   */
  const [dockerOpen, setDockerOpen] = useState(false);

  return (
    <footer
      aria-label="Status"
      data-testid="status-bar"
      className={cn(
        // 28px, not the audit's impossible 24. `relative` is for the connection-colour strip.
        'relative flex h-7 shrink-0 items-center gap-3 border-t border-rule bg-chrome px-3'
      )}
    >
      {/* The connection colour. Absolutely positioned so it cannot take height from the bar — the
          audit's `border-top: 3px solid <color>` did exactly that. It paints over the hairline
          rather than beside it, so the bar's total height is the same with and without it. */}
      {profile?.color === undefined ? null : (
        <span
          aria-hidden="true"
          data-testid="status-connection-color"
          className="absolute inset-x-0 top-0 h-0.5"
          style={{ backgroundColor: profile.color }}
        />
      )}

      <div className="flex min-w-0 shrink items-center gap-3">
        <ConnectionSegment />
      </div>

      <span className="grow" />

      <div className="flex shrink-0 items-center gap-1">
        {/* First in the right-hand cluster: it is the only thing here that reports a fault the
            user cannot otherwise see, and `shrink-0` means the connection name truncates
            before this does. */}
        <KeychainIndicator />

        <Segment testId="status-tab-count">
          <span className="tabular-nums">{tabCount}</span>
          <span>{tabCount === 1 ? 'tab' : 'tabs'}</span>
        </Segment>

        {cursor === null ? null : (
          <Segment testId="status-cursor" className="font-mono tabular-nums">
            Ln {cursor.line}, Col {cursor.column}
          </Segment>
        )}

        <Tooltip content="Output / Console (⌘J)">
          <button
            type="button"
            aria-label="Output / Console"
            aria-pressed={outputOpen}
            data-testid="status-output-toggle"
            onClick={() => logStore.getState().toggle()}
            className={cn(CONTROL_CLASSES, unseenErrors > 0 && 'text-danger')}
          >
            <Icon icon={Terminal} size="sm" />
            {/* Inside the button, not overhanging it: finding 2. */}
            {unseenErrors > 0 ? (
              <span data-testid="status-output-badge" className="tabular-nums">
                {unseenErrors}
              </span>
            ) : errorCount > 0 && outputOpen ? (
              <span data-testid="status-output-errors" className="tabular-nums text-danger">
                {errorCount}
              </span>
            ) : null}
          </button>
        </Tooltip>

        <Tooltip
          content={chatOpen ? 'Close the AI assistant (⇧⌘I)' : 'Open the AI assistant (⇧⌘I)'}
        >
          <button
            type="button"
            aria-label="AI assistant"
            aria-pressed={chatOpen}
            data-testid="status-chat-toggle"
            onClick={() => chatPanelStore.getState().togglePanel()}
            className={CONTROL_CLASSES}
          >
            <Icon icon={Sparkles} size="sm" />
          </button>
        </Tooltip>

        <DockerPip
          controlClassName={CONTROL_CLASSES}
          open={dockerOpen}
          onOpenChange={setDockerOpen}
        />

        <ThemeMenu />

        <Segment testId="status-version">
          <span className="tabular-nums">
            {version.data === undefined ? 'Joinery' : `Joinery v${version.data}`}
          </span>
        </Segment>
      </div>
    </footer>
  );
}
