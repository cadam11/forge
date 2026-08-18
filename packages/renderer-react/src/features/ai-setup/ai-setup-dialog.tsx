/**
 * The AI setup dialog: choose a vendor, give it a key, pick the model, turn the features on.
 *
 * Replaces `shared/components/ai-setup-dialog/ai-setup-dialog.component.ts` (305) **and** closes the
 * renderer half of J-55 — the Angular settings panel's sixth group (`settings-panel.component.ts:327-488`:
 * master enable, three feature toggles, per-vendor enable / preferred model / key save+remove) had no
 * React equivalent at all, so this build could not configure a provider and the chat panel said so.
 *
 * ── Secrets discipline: the Task 9 bar, restated because this is the other file it binds ────
 *
 * An API key entered here reaches exactly two places: `ai.validateApiKey` and `ai.setApiKey`, both as a
 * call argument, both through `state/ai.ts`. It is therefore:
 *
 *  - **never in a query key.** `useIpcQuery`/`useIpcMutation` refuse to derive keys from call arguments
 *    (`ipc/use-ipc-call.ts`), and this dialog uses the store rather than either, so there is no cache
 *    entry to leak from;
 *  - **never in renderer persistence.** Nothing here writes to `app.setState`, `localStorage` or the
 *    tab store; the only thing that survives the dialog is the main process's own `apiKeyConfigured`
 *    boolean, which is what `state/ai.ts` holds;
 *  - **never in a log or a toast.** Every failure path reports the vendor, never the key. The store's
 *    `diagnostics.error` calls pass the caught error, not the argument;
 *  - **never in the DOM after the dialog closes.** The field is local state on a component that
 *    unmounts, and it is cleared on a successful save before the vendor is switched.
 *
 * The vendor list itself is not a secret and is fetched normally.
 *
 * ── Why the whole vendor list, and not the Angular four-card grid ───────────────────────────
 *
 * The Angular dialog hard-coded four provider cards (`google`, `openai`, `anthropic`, `groq`) in the
 * component, so a vendor added to `ai-vendors.json` — Cerebras, which main already supports — was
 * unreachable from the UI. The list here is `ai.getVendors()`, so the config file is the single source
 * of truth and the dialog cannot fall behind it.
 */

import { useState, type FormEvent } from 'react';
import { Check, KeyRound, Sparkles, Trash2 } from 'lucide-react';
import type { AIVendor, AIVendorSettings, OpenRouterCostTier } from '@joinery/shared';
import { OPENROUTER_AUTO_ROUTERS, OPENROUTER_COST_TIERS } from '@joinery/shared';

import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
  Select,
  SelectItem,
  Spinner,
  Switch,
  cn,
} from '../../ui';
import { FormNote, FormSection } from '../forms';
import {
  selectHasConfiguredVendors,
  selectVendorSettings,
  useAIStore,
  type AIStoreState,
} from '../../state/ai';

export interface AiSetupDialogProps {
  readonly onDismiss: () => void;
}

/** The vendor settings entry for `vendorId`, or the all-off shape a never-touched vendor implies. */
function settingsFor(state: AIStoreState, vendorId: string): AIVendorSettings {
  return (
    selectVendorSettings(vendorId)(state) ?? {
      vendorId,
      enabled: false,
      apiKeyConfigured: false,
      priority: 99,
    }
  );
}

/** The model a vendor defaults to when the user has not chosen one. */
function defaultModelId(vendor: AIVendor): string | undefined {
  return (vendor.models.find(model => model.default) ?? vendor.models[0])?.id;
}

/**
 * Radix `Select` refuses `value=""` — it reserves the empty string for "no selection" — so the
 * unset row needs a sentinel. It is never persisted: `chooseCostTier` maps it back to `undefined`.
 */
const COST_TIER_UNSET = 'provider-default';

/** Human labels for the five bands. A band is not a ceiling, so the copy says "around". */
const COST_TIER_LABELS: Readonly<Record<OpenRouterCostTier, string>> = {
  low: 'Low — cheapest models',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Very high',
  max: 'Max — most capable models',
};

/**
 * Whether this vendor has anything a cost tier could apply to. Derived from the shared router
 * table rather than a `vendor.id === 'openrouter'` test, so the control appears exactly where the
 * request builder would act on it.
 */
function offersAutoRouter(vendor: AIVendor): boolean {
  return vendor.models.some(model => OPENROUTER_AUTO_ROUTERS.has(model.apiName));
}

/**
 * The routing preference OpenRouter's Auto Router models take. Applies to nothing else the vendor
 * offers, which is what the hint says, and sending none is a distinct choice — OpenRouter then
 * routes roughly as if the low band had been asked for.
 */
function AutoRouterCostTier({ vendor }: { readonly vendor: AIVendor }) {
  const costTier = useAIStore(state => settingsFor(state, vendor.id).autoRouterCostTier);

  const chooseCostTier = (next: string): void => {
    const tier = next === COST_TIER_UNSET ? undefined : (next as OpenRouterCostTier);
    void useAIStore.getState().setAutoRouterCostTier(vendor.id, tier);
  };

  return (
    <Select
      name="ai-cost-tier"
      label="Auto-router cost tier"
      data-testid="ai-setup-cost-tier"
      value={costTier ?? COST_TIER_UNSET}
      onValueChange={chooseCostTier}
      hint="Applies only to the Auto Router models. Left unset, OpenRouter picks the band itself."
    >
      <SelectItem value={COST_TIER_UNSET}>Provider default</SelectItem>
      {OPENROUTER_COST_TIERS.map(tier => (
        <SelectItem key={tier} value={tier}>
          {COST_TIER_LABELS[tier]}
        </SelectItem>
      ))}
    </Select>
  );
}

export function AiSetupDialog({ onDismiss }: AiSetupDialogProps) {
  const vendors = useAIStore(state => state.vendors);
  const loading = useAIStore(state => state.loading);
  const validating = useAIStore(state => state.validatingKey);
  const enabled = useAIStore(state => state.settings.enabled);
  const configured = useAIStore(selectHasConfiguredVendors);

  /**
   * Which vendor the form is pointed at. Seeded from the first vendor that already has a key — a user
   * re-opening this to change a model should land on the one they configured — and otherwise the first
   * in the catalogue, which `ai-vendors.json` orders by preference.
   */
  const [vendorId, setVendorId] = useState<string>(() => {
    const state = useAIStore.getState();
    const withKey = state.settings.vendorSettings.find(entry => entry.apiKeyConfigured);
    return withKey?.vendorId ?? state.vendors[0]?.id ?? '';
  });

  /**
   * The key being typed. Local state on a component that unmounts with the dialog, and cleared as soon
   * as a save succeeds — see the module header. Never lifted into a store.
   */
  const [apiKey, setApiKey] = useState('');
  /** What the last save attempt said. Cleared whenever the vendor or the key changes. */
  const [result, setResult] = useState<'saved' | 'rejected' | null>(null);

  const vendor = vendors.find(candidate => candidate.id === vendorId);
  // Three scalar subscriptions rather than one that returns the settings object: `settingsFor`
  // synthesises a fresh record for a vendor with no entry, so subscribing to it would hand zustand a
  // new identity on every store write (`state/capabilities.ts` rule 3).
  const vendorEnabled = useAIStore(state => settingsFor(state, vendorId).enabled);
  const keyConfigured = useAIStore(state => settingsFor(state, vendorId).apiKeyConfigured);
  const preferredModelId = useAIStore(
    state => settingsFor(state, vendorId).preferredModelId ?? (vendor ? defaultModelId(vendor) : '')
  );

  const chooseVendor = (next: string): void => {
    setVendorId(next);
    setApiKey('');
    setResult(null);
  };

  const save = (event: FormEvent): void => {
    event.preventDefault();
    if (vendor === undefined || apiKey.trim() === '') return;
    void (async () => {
      const saved = await useAIStore.getState().setApiKey(vendor.id, apiKey);
      if (!saved) {
        setResult('rejected');
        return;
      }
      // Cleared BEFORE anything else awaits, so the key is not sitting in state across a second
      // round trip. The master switch follows, which is what the Angular dialog's "Enable AI" did.
      setApiKey('');
      setResult('saved');
      await useAIStore.getState().setEnabled(true);
    })();
  };

  const removeKey = (): void => {
    if (vendor === undefined) return;
    setResult(null);
    void useAIStore.getState().removeApiKey(vendor.id);
  };

  return (
    <Dialog open onOpenChange={next => (next ? undefined : onDismiss())}>
      <DialogContent size="md" data-testid="ai-setup-dialog">
        <DialogHeader>
          <DialogTitle>AI setup</DialogTitle>
          <DialogDescription>
            Pick a provider and give it an API key. Keys are held by the main process in the system
            keychain — this window never stores one.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {loading && vendors.length === 0 ? (
            <Spinner label="Loading providers…" />
          ) : (
            <>
              <FormSection title="Provider">
                <Select
                  name="ai-vendor"
                  label="Provider"
                  data-testid="ai-setup-vendor"
                  value={vendorId}
                  onValueChange={chooseVendor}
                  placeholder="Choose a provider"
                >
                  {vendors.map(candidate => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </Select>

                {vendor === undefined ? (
                  <FormNote data-testid="ai-setup-no-vendors">
                    No providers are configured in this build.
                  </FormNote>
                ) : (
                  <>
                    <form onSubmit={save} className="flex flex-col gap-2">
                      <Input
                        name="ai-api-key"
                        // `type="password"` so the value is not shoulder-readable and browsers do not
                        // offer to remember it; `autoComplete="off"` for the same reason.
                        type="password"
                        label="API key"
                        autoComplete="off"
                        spellCheck={false}
                        data-testid="ai-setup-key"
                        placeholder={
                          keyConfigured ? 'A key is already saved' : `${vendor.name} key`
                        }
                        value={apiKey}
                        onChange={event => {
                          setApiKey(event.target.value);
                          setResult(null);
                        }}
                        hint="Validated with the provider before it is written to the keychain."
                      />
                      <div className="flex items-center gap-2">
                        {/* The one filled oxide affordance in this dialog — HOUSE-RULES §5. */}
                        <Button
                          variant="primary"
                          type="submit"
                          size="sm"
                          leadingIcon={KeyRound}
                          disabled={apiKey.trim() === '' || validating}
                          data-testid="ai-setup-save-key"
                        >
                          {validating ? 'Checking…' : 'Save key'}
                        </Button>
                        {keyConfigured ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            leadingIcon={Trash2}
                            onClick={removeKey}
                            data-testid="ai-setup-remove-key"
                          >
                            Remove key
                          </Button>
                        ) : null}
                      </div>
                    </form>

                    <p
                      data-testid="ai-setup-key-state"
                      data-state={
                        result === 'rejected' ? 'rejected' : keyConfigured ? 'saved' : 'none'
                      }
                      className={cn(
                        'flex items-center gap-1.5 text-sm',
                        result === 'rejected' ? 'text-danger' : 'text-fg-muted'
                      )}
                    >
                      {result === 'rejected' ? (
                        `That key was rejected by ${vendor.name}.`
                      ) : keyConfigured ? (
                        <>
                          <Icon icon={Check} size="sm" className="stroke-success" />
                          {vendor.name} has a key in the keychain.
                        </>
                      ) : (
                        `No key saved for ${vendor.name}.`
                      )}
                    </p>

                    <Select
                      name="ai-model"
                      label="Preferred model"
                      data-testid="ai-setup-model"
                      value={preferredModelId ?? ''}
                      onValueChange={modelId =>
                        void useAIStore.getState().setPreferredModel(vendor.id, modelId)
                      }
                      placeholder="Provider default"
                    >
                      {vendor.models.map(model => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </Select>

                    {offersAutoRouter(vendor) ? <AutoRouterCostTier vendor={vendor} /> : null}

                    <Switch
                      name="ai-vendor-enabled"
                      label="Use this provider"
                      data-testid="ai-setup-vendor-enabled"
                      checked={vendorEnabled}
                      onChange={event =>
                        void useAIStore.getState().setVendorEnabled(vendor.id, event.target.checked)
                      }
                      hint="A provider needs both a key and this switch before chat will use it."
                    />
                  </>
                )}
              </FormSection>

              <FormSection title="Features">
                <Switch
                  name="ai-enabled"
                  label="AI features"
                  data-testid="ai-setup-enabled"
                  checked={enabled}
                  onChange={event => void useAIStore.getState().setEnabled(event.target.checked)}
                  hint="The master switch for tab renaming, result analysis and query assist. Chat is gated on a configured provider instead, which is what the main process checks."
                />
                <FeatureToggles />
              </FormSection>
            </>
          )}
        </DialogBody>

        <DialogActions>
          <p data-testid="ai-setup-summary" className="mr-auto text-sm text-fg-muted">
            {configured ? (
              <span className="flex items-center gap-1.5">
                <Icon icon={Sparkles} size="sm" className="stroke-fg-muted" />
                The assistant is ready to use.
              </span>
            ) : (
              'Chat stays disabled until one provider has a key and is switched on.'
            )}
          </p>
          <DialogClose asChild>
            <Button data-testid="ai-setup-done">Done</Button>
          </DialogClose>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

/** The three one-shot features the master switch gates. Ported from the Angular panel's sixth group. */
function FeatureToggles() {
  const features = useAIStore(state => state.settings.features);
  const update = useAIStore.getState().updateFeatureSettings;

  return (
    <>
      <Switch
        name="ai-auto-rename"
        label="Rename tabs from the query"
        data-testid="ai-setup-auto-rename"
        checked={features.autoRenameEnabled}
        onChange={event => void update({ autoRenameEnabled: event.target.checked })}
      />
      <Switch
        name="ai-analysis"
        label="Explain results"
        data-testid="ai-setup-analysis"
        checked={features.analysisEnabled}
        onChange={event => void update({ analysisEnabled: event.target.checked })}
      />
      <Switch
        name="ai-query-assist"
        label="Suggest SQL while typing"
        data-testid="ai-setup-query-assist"
        checked={features.queryAssistEnabled}
        onChange={event => void update({ queryAssistEnabled: event.target.checked })}
      />
    </>
  );
}
