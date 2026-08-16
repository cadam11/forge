/**
 * The connection editor — create or edit one profile, test it, save it, connect with it.
 *
 * Replaces `shared/components/connection-dialog/connection-dialog.component.ts` (1,040 LOC). Almost
 * none of that is here: the auth-mode rules, engine-switch heuristics, DSQL sniffing and profile
 * builders moved to `form-model.ts` (pure), the validation moved to `form-schema.ts` (an adapter
 * over the shared validators), and the three-positional-passwords call is behind `secrets.ts`. What
 * is left in this file is markup, four action handlers and the `react-hook-form` wiring.
 *
 * ── Four decisions that differ from the Angular dialog, all deliberate ────────────────────────
 *
 * 1. **The actions are never disabled for invalidity.** Angular disabled Save and Connect on
 *    `!isValid()` and then had to add a `validationHint()` paragraph to explain the dead button —
 *    two implementations of the same rule, which disagreed (see `form-schema.ts:firstErrorMessage`).
 *    Here a click validates: invalid means per-field error text, focus moved to the first offender,
 *    and one summary line above the row. `buttons.md` prefers this, and it is the difference between
 *    "nothing happens" and being told why.
 * 2. **Test validates a subset.** `TEST_FIELDS` is the field list, so "Test works on a form with no
 *    name yet" survives as data rather than as a second predicate.
 * 3. **The Server field normalizes on blur, not per keystroke.** See `form-model.ts:normalizeServer`.
 * 4. **Radix `Select`s are controlled from watched form state** and written back through
 *    `setValues`, because engine and auth-mode changes are multi-field transforms. Every plain input
 *    is `register`ed and therefore uncontrolled, which is what keeps typing cheap in a 23-field form.
 *
 * ── Secrets ─────────────────────────────────────────────────────────────────────────────────
 *
 * The three password fields live in form state and go nowhere except `secretsFrom()` →
 * `secrets.ts` → the store → the bridge → keytar. `type="password"`, `autoComplete="off"`, and no
 * value of theirs reaches a log line, a query key, or persisted state. `form-model.ts`'s
 * `formValuesFromProfile` always opens an existing profile with all three blank, which is what makes
 * a blank box mean "keep what is in the keychain".
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plug, X } from 'lucide-react';
import {
  ENGINE_LABELS,
  type ConnectionProfile,
  type DatabaseEngine,
  type TestConnectionResult,
} from '@joinery/shared';

import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
  Select,
  SelectItem,
  Spinner,
  Tooltip,
  cn,
} from '../../ui';
import { useIpcQuery } from '../../ipc';
import { diagnostics } from '../../state/diagnostics';
import { connectProfile } from '../../shell/sidebar/node-actions';
import { PasswordHygieneWarning } from './password-hygiene-warning';
import { TestResultPanel } from './test-result-panel';
import { secretsFrom, saveProfileWithSecrets, testProfileWithSecrets } from './secrets';
import { TEST_FIELDS, connectionFormSchema, firstErrorMessage } from './form-schema';
import {
  AUTH_MODES,
  DEFAULT_DATABASE_HINTS,
  ENGINES,
  MYSQL_COLLATIONS,
  NEW_CONNECTION_VALUES,
  PRESET_COLORS,
  applyAuthModeChange,
  applyEngineChange,
  awsProfileOptions,
  buildProfileDraft,
  buildTestProfile,
  formValuesFromProfile,
  isAwsIamAuth,
  isEntraAuth,
  needsPassword,
  needsUsername,
  normalizeServer,
  type ConnectionFormValues,
} from './form-model';

/**
 * Radix refuses an empty `SelectItem` value (it reserves `''` for "no selection"), so "server
 * default" travels through the collation picker as this sentinel and is mapped back to `''` — the
 * form model's own spelling for absent — at the one boundary below.
 */
const SERVER_DEFAULT_COLLATION = 'server-default';

/** Which action is in flight. One piece of state for three buttons. */
type PendingAction = 'test' | 'save' | 'connect';

export interface ConnectionEditorProps {
  /** The profile to edit. Omitted for a create. */
  readonly profile?: ConnectionProfile;
  /** Pre-filled server/port, for the Docker-container entry point (Task 19). */
  readonly prefill?: { readonly server?: string; readonly port?: number };
  /** Escape, the close button, or Cancel. */
  readonly onDismiss: () => void;
  /** A profile was written. `connected` is true only when Connect also succeeded. */
  readonly onSaved: (profile: ConnectionProfile, connected: boolean) => void;
}

export function ConnectionEditor({ profile, prefill, onDismiss, onSaved }: ConnectionEditorProps) {
  const isEditing = profile !== undefined;

  const defaultValues = useMemo<ConnectionFormValues>(() => {
    if (profile !== undefined) return formValuesFromProfile(profile);
    return {
      ...NEW_CONNECTION_VALUES,
      ...(prefill?.server === undefined ? {} : { server: prefill.server }),
      ...(prefill?.port === undefined ? {} : { port: prefill.port }),
    };
  }, [profile, prefill]);

  const form = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionFormSchema),
    defaultValues,
    // Validation is a submit-time (or Test-time) event, then live while the user fixes it. Validating
    // an untouched form on mount would open the dialog covered in red.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });
  const values = useFormValues(form);

  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  /**
   * Any edit invalidates the last Test result, so a stale error can never describe a configuration
   * the user has since changed.
   *
   * Angular achieved this with an `(input)` listener on the dialog content plus an explicit
   * `clearTestResult()` on every select and checkbox (`connection-dialog.component.ts:77,132,225`) —
   * three mechanisms, and the colour swatches were missed by all of them. One value subscription
   * covers every field including the ones written programmatically by the engine transform.
   */
  useEffect(
    () => form.subscribe({ formState: { values: true }, callback: () => setTestResult(null) }),
    [form]
  );

  const awsProfiles = useAwsProfiles(isAwsIamAuth(values));
  const awsOptions = awsProfileOptions(awsProfiles, values.awsProfile);

  /** Applies a pure whole-form transform, re-validating only if the user has already been told. */
  const transform = (next: ConnectionFormValues): void => {
    form.setValues(next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  };

  const runTest = async (): Promise<void> => {
    // A subset of the fields Save needs — see `TEST_FIELDS`. The spread is because `trigger` wants a
    // mutable array and the constant is readonly.
    if (!(await form.trigger([...TEST_FIELDS], { shouldFocus: true }))) return;

    setPending('test');
    setTestResult(null);
    try {
      const current = form.getValues();
      const result = await testProfileWithSecrets(
        buildTestProfile(current, profile),
        secretsFrom(current)
      );
      // Successes toast (the store does it); only failures render inline, which is why one panel can
      // be bound straight to this state.
      setTestResult(result.success ? null : result);
    } finally {
      setPending(null);
    }
  };

  /** Save, and report whether it landed. Errors are already toasted by the store. */
  const persist = async (current: ConnectionFormValues): Promise<ConnectionProfile | null> =>
    saveProfileWithSecrets(buildProfileDraft(current, profile), secretsFrom(current));

  const submitSave = form.handleSubmit(async current => {
    setPending('save');
    try {
      const saved = await persist(current);
      if (saved !== null) onSaved(saved, false);
    } finally {
      setPending(null);
    }
  });

  const submitConnect = form.handleSubmit(async current => {
    setPending('connect');
    try {
      const saved = await persist(current);
      if (saved === null) return;
      // `connectProfile` owns the explorer side effects (add the server node, expand it) and toasts
      // its own failure. The dialog stays open on a failed connect so the user can correct the form —
      // which is the Angular behaviour (`connectNow` only closed on success).
      if (await connectProfile(saved.id)) onSaved(saved, true);
    } finally {
      setPending(null);
    }
  });

  const busy = pending !== null;
  const hint = firstErrorMessage(form.formState.errors);

  return (
    <Dialog open onOpenChange={open => (open ? undefined : onDismiss())}>
      <DialogContent size="md" data-testid="connection-editor">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Icon icon={Plug} size="sm" className="stroke-fg-muted" />
              {isEditing ? 'Edit connection' : 'New connection'}
            </span>
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Leave a password blank to keep the one already in your keychain.'
              : 'Passwords are stored in the macOS keychain, never in a file.'}
          </DialogDescription>
        </DialogHeader>

        {/* The form element wraps the body AND the actions so Enter submits and the two Save paths
            are one code path. `min-h-0` so `DialogBody`'s own scroll still works inside it. */}
        <form
          className="flex min-h-0 flex-col"
          onSubmit={event => {
            void submitSave(event);
          }}
        >
          <DialogBody className="flex flex-col gap-3">
            <Select
              label="Database engine"
              name="engine"
              value={values.engine}
              onValueChange={next => transform(applyEngineChange(values, next as DatabaseEngine))}
              data-testid="connection-engine"
            >
              {ENGINES.map(engine => (
                <SelectItem key={engine} value={engine}>
                  {ENGINE_LABELS[engine]}
                </SelectItem>
              ))}
            </Select>

            <Input
              label="Connection name"
              hint="A friendly name for this connection"
              placeholder="Production reporting"
              error={form.formState.errors.name?.message}
              data-testid="connection-name"
              {...form.register('name')}
            />

            <div className="flex gap-3">
              <Input
                label="Server"
                placeholder="localhost or hostname"
                fieldClassName="grow-[2] basis-0"
                error={form.formState.errors.server?.message}
                data-testid="connection-server"
                {...form.register('server', {
                  // Blur, not change — see decision 3 in the header.
                  onBlur: () => transform(normalizeServer(form.getValues())),
                })}
              />
              <Input
                label="Port"
                type="number"
                fieldClassName="grow basis-0"
                className="tabular-nums"
                error={form.formState.errors.port?.message}
                data-testid="connection-port"
                {...form.register('port', { valueAsNumber: true })}
              />
            </div>

            <Section title="Authentication">
              {AUTH_MODES[values.engine].length > 1 ? (
                <Select
                  label="Authentication type"
                  name="authenticationType"
                  value={values.authenticationType}
                  onValueChange={next =>
                    transform(
                      applyAuthModeChange(
                        values,
                        next as ConnectionFormValues['authenticationType']
                      )
                    )
                  }
                  data-testid="connection-auth-type"
                >
                  {AUTH_MODES[values.engine].map(mode => (
                    <SelectItem key={mode.value} value={mode.value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </Select>
              ) : null}

              {needsUsername(values) ? (
                <div className="flex gap-3">
                  <Input
                    label="Username"
                    fieldClassName="grow basis-0"
                    autoComplete="off"
                    error={form.formState.errors.username?.message}
                    data-testid="connection-username"
                    {...form.register('username')}
                  />
                  {needsPassword(values) ? (
                    <Input
                      label="Password"
                      type="password"
                      fieldClassName="grow basis-0"
                      autoComplete="off"
                      data-testid="connection-password"
                      {...form.register('password')}
                    />
                  ) : null}
                </div>
              ) : null}

              {needsPassword(values) ? <PasswordHygieneWarning value={values.password} /> : null}

              {isEntraAuth(values) ? (
                <Note testId="connection-entra-note">
                  Signs in through the Microsoft login window. Supports MFA.
                </Note>
              ) : null}

              {isAwsIamAuth(values) ? (
                <>
                  {/* Discovered names, not `awsOptions`: the picker is only offered when something
                      was actually found on disk. `awsOptions` then decides what is IN it, so a saved
                      profile naming a credentials profile the list lacks still shows its own value.
                      Nothing discovered at all means free-text entry, which is the degraded path when
                      there is no `~/.aws` or no CLI. */}
                  {awsProfiles.length > 0 ? (
                    <Select
                      label="AWS profile"
                      name="awsProfile"
                      placeholder="default"
                      value={values.awsProfile}
                      onValueChange={next => transform({ ...values, awsProfile: next })}
                      data-testid="connection-aws-profile"
                    >
                      {awsOptions.map(name => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      label="AWS profile"
                      placeholder="default"
                      data-testid="connection-aws-profile"
                      {...form.register('awsProfile')}
                    />
                  )}
                  <Note testId="connection-aws-note">
                    Tokens are minted from your AWS credentials each time you connect — nothing is
                    stored.
                  </Note>
                </>
              ) : null}
            </Section>

            <Section title="Colour tag">
              <ColorPicker
                value={values.color}
                onChange={color => transform({ ...values, color })}
              />
            </Section>

            <Section title="Options">
              {isAwsIamAuth(values) ? (
                <Note testId="connection-dsql-tls-note">
                  TLS is always on and the server certificate is always validated for Aurora DSQL.
                </Note>
              ) : (
                <div className="flex flex-col gap-2">
                  <Checkbox
                    label="Encrypt the connection"
                    data-testid="connection-encrypt"
                    {...form.register('encrypt')}
                  />
                  <Checkbox
                    label="Trust the server certificate"
                    data-testid="connection-trust-cert"
                    {...form.register('trustServerCertificate')}
                  />
                </div>
              )}

              <div className="flex gap-3">
                <Input
                  label="Timeout (seconds)"
                  type="number"
                  fieldClassName="grow basis-0"
                  className="tabular-nums"
                  data-testid="connection-timeout"
                  {...form.register('connectionTimeout', { valueAsNumber: true })}
                />
                <Input
                  label="Default database"
                  placeholder={DEFAULT_DATABASE_HINTS[values.engine]}
                  fieldClassName="grow basis-0"
                  hint={
                    isEntraAuth(values)
                      ? 'Leave blank to connect to master — most users need a specific database.'
                      : undefined
                  }
                  data-testid="connection-database"
                  {...form.register('database')}
                />
              </div>

              {values.engine === 'mysql' ? (
                <Select
                  label="Collation"
                  name="mysqlCollation"
                  hint="Match your server's collation to avoid “Illegal mix of collations” errors."
                  value={
                    values.mysqlCollation === '' ? SERVER_DEFAULT_COLLATION : values.mysqlCollation
                  }
                  onValueChange={next =>
                    transform({
                      ...values,
                      mysqlCollation: next === SERVER_DEFAULT_COLLATION ? '' : next,
                    })
                  }
                  data-testid="connection-collation"
                >
                  {MYSQL_COLLATIONS.map(collation => (
                    <SelectItem
                      key={collation.value}
                      value={collation.value === '' ? SERVER_DEFAULT_COLLATION : collation.value}
                    >
                      {collation.label}
                    </SelectItem>
                  ))}
                </Select>
              ) : null}
            </Section>

            <Section title="SSH tunnel" testId="connection-section-ssh">
              {isAwsIamAuth(values) ? (
                <Note testId="connection-dsql-ssh-note">
                  SSH tunnelling isn’t available with AWS IAM authentication — Aurora DSQL is
                  reached over a public TLS endpoint.
                </Note>
              ) : (
                <SshFields form={form} values={values} />
              )}
            </Section>
          </DialogBody>

          {/* The answer region: one ruled band between the scrolling form and the action row, holding
              whatever the last action had to say. Both children are wells with a rule down their
              edge — amber for "this needs your attention", danger for "the server said no" — so the
              two read as one visual language. A band with `gap-*` rather than per-child margins,
              per `general.md`. */}
          {hint === undefined && testResult === null ? null : (
            <div className="flex shrink-0 flex-col gap-2 border-t border-rule px-4 py-3">
              {hint === undefined ? null : (
                <p
                  role="status"
                  data-testid="connection-validation-hint"
                  className="rounded-sm border-l-2 border-warning bg-surface p-2 text-sm text-fg text-pretty"
                >
                  {hint}
                </p>
              )}
              <TestResultPanel result={testResult} />
            </div>
          )}

          <DialogActions>
            <Button
              variant="ghost"
              disabled={busy}
              data-testid="connection-cancel"
              onClick={onDismiss}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              data-testid="connection-test"
              onClick={() => void runTest()}
            >
              {pending === 'test' ? <Spinner size="sm" /> : 'Test'}
            </Button>
            <Button variant="outline" type="submit" disabled={busy} data-testid="connection-save">
              {pending === 'save' ? <Spinner size="sm" /> : 'Save'}
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              data-testid="connection-connect"
              onClick={() => void submitConnect()}
            >
              {pending === 'connect' ? <Spinner size="sm" /> : 'Connect'}
            </Button>
          </DialogActions>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The whole form as a value, re-rendering the editor on any change.
 *
 * `useWatch` rather than `useForm().watch()`, and the reason is a lint gate rather than taste: the
 * React Compiler rule `react-hooks/incompatible-library` refuses to memoize a component that calls
 * `watch()`, because the function `useForm` returns cannot be memoized without risking stale UI.
 * `useWatch` is a real hook and is compiler-safe.
 *
 * The subscription and the read are deliberately split. `useWatch`'s no-name overload is typed
 * `DeepPartialSkipArrayKey<T>` — "every field possibly absent" — which is false for this model:
 * `defaultValues` is total and `shouldUnregister` defaults to false, so every field is always
 * present. Rather than cast that partial back to the truth, `useWatch` is used only for its
 * re-render and the value comes from `getValues()`, which is typed honestly. By the time the
 * re-render commits, `getValues()` already reflects the change that caused it — both read the same
 * internal store.
 */
function useFormValues(form: UseFormReturn<ConnectionFormValues>): ConnectionFormValues {
  useWatch({ control: form.control });
  return form.getValues();
}

/**
 * The AWS CLI/config profile names, for the `aws-iam` picker.
 *
 * Fetched once per dialog and cached for it; a failure (no `~/.aws`, no CLI) degrades to an empty
 * list, which the editor renders as a free-text input instead. `retry: false` because the answer
 * does not become available by asking again, and the diagnostic is logged rather than swallowed —
 * the Angular version wrote it to `console.warn`, which the Output panel never saw.
 */
function useAwsProfiles(enabled: boolean): readonly string[] {
  const query = useIpcQuery({
    namespace: 'connection',
    operation: 'listAwsProfiles',
    enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (query.error !== null) {
      diagnostics.warn('could not list AWS profiles; falling back to free-text entry', query.error);
    }
  }, [query.error]);

  return query.data ?? [];
}

/** A ruled group with a mono eyebrow, per HOUSE-RULES §2. */
function Section({
  title,
  testId,
  children,
}: {
  readonly title: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="flex flex-col gap-3 border-t border-rule pt-3">
      <h3 className="font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** An explanatory line under a control. `text-fg-muted`, never `text-fg-subtle` (HOUSE-RULES §5). */
function Note({ testId, children }: { readonly testId: string; readonly children: ReactNode }) {
  return (
    <p data-testid={testId} className="text-sm text-fg-muted text-pretty">
      {children}
    </p>
  );
}

/**
 * The eight preset colour tags plus "no colour".
 *
 * `aria-pressed` rather than a radio group: there is no "required" selection and the eighth swatch
 * is a clear, so this is a row of toggles over one value. Each swatch carries its colour name as its
 * accessible name — a swatch whose only label is a hex is unusable with a screen reader, and the
 * Angular version had only a `matTooltip`.
 */
function ColorPicker({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2" data-testid="connection-color-picker">
      {PRESET_COLORS.map(color => (
        <Tooltip key={color.value} content={color.label}>
          <button
            type="button"
            aria-label={color.label}
            aria-pressed={value === color.value}
            data-testid={`connection-color-${color.label.toLowerCase()}`}
            // The colour is user data, so it travels as a custom property and the utility reads it —
            // `general.md`'s rule for dynamic values.
            style={{ '--swatch': color.value } as CSSProperties}
            className={cn(
              'size-5 rounded-full bg-(--swatch)',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              value === color.value ? 'ring-2 ring-fg ring-offset-2 ring-offset-elevated' : null
            )}
            onClick={() => onChange(color.value)}
          />
        </Tooltip>
      ))}
      <Tooltip content="No colour">
        <button
          type="button"
          aria-label="No colour"
          aria-pressed={value === ''}
          data-testid="connection-color-none"
          className={cn(
            'flex size-5 items-center justify-center rounded-full border border-dashed border-rule-strong',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            value === '' ? 'ring-2 ring-fg ring-offset-2 ring-offset-elevated' : null
          )}
          onClick={() => onChange('')}
        >
          <Icon icon={X} size="sm" className="size-3 stroke-fg-subtle" />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * The tunnel. Split out because it is the one section with its own nested branch (password versus
 * private key) and inlining it put four levels of conditional JSX in the middle of the form.
 */
function SshFields({
  form,
  values,
}: {
  readonly form: UseFormReturn<ConnectionFormValues>;
  readonly values: ConnectionFormValues;
}) {
  const { errors } = form.formState;

  return (
    <div className="flex flex-col gap-3">
      <Checkbox
        label="Connect through an SSH tunnel"
        data-testid="connection-ssh-enabled"
        {...form.register('sshEnabled')}
      />

      {!values.sshEnabled ? null : (
        <>
          <div className="flex gap-3">
            <Input
              label="SSH host"
              placeholder="bastion.example.com"
              fieldClassName="grow-[2] basis-0"
              error={errors.sshHost?.message}
              data-testid="connection-ssh-host"
              {...form.register('sshHost')}
            />
            <Input
              label="SSH port"
              type="number"
              fieldClassName="grow basis-0"
              className="tabular-nums"
              error={errors.sshPort?.message}
              data-testid="connection-ssh-port"
              {...form.register('sshPort', { valueAsNumber: true })}
            />
          </div>

          <Input
            label="SSH username"
            autoComplete="off"
            error={errors.sshUsername?.message}
            data-testid="connection-ssh-username"
            {...form.register('sshUsername')}
          />

          <Select
            label="SSH authentication"
            name="sshAuthType"
            value={values.sshAuthType}
            onValueChange={next =>
              form.setValues(
                { sshAuthType: next as ConnectionFormValues['sshAuthType'] },
                { shouldDirty: true, shouldValidate: form.formState.isSubmitted }
              )
            }
            data-testid="connection-ssh-auth-type"
          >
            <SelectItem value="password">Password</SelectItem>
            <SelectItem value="privateKey">Private key</SelectItem>
          </Select>

          {values.sshAuthType === 'password' ? (
            <>
              <Input
                label="SSH password"
                type="password"
                autoComplete="off"
                data-testid="connection-ssh-password"
                {...form.register('sshPassword')}
              />
              <PasswordHygieneWarning
                value={values.sshPassword}
                data-testid="ssh-password-hygiene-warning"
              />
            </>
          ) : (
            <>
              <Input
                label="Private key path"
                placeholder="~/.ssh/id_rsa"
                error={errors.sshPrivateKeyPath?.message}
                data-testid="connection-ssh-key-path"
                {...form.register('sshPrivateKeyPath')}
              />
              <Input
                label="Passphrase (optional)"
                type="password"
                autoComplete="off"
                data-testid="connection-ssh-passphrase"
                {...form.register('sshPassphrase')}
              />
              <PasswordHygieneWarning
                value={values.sshPassphrase}
                data-testid="ssh-passphrase-hygiene-warning"
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
