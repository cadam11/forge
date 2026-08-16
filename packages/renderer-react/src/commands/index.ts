/**
 * The typed command bus, replacing the `joinery:*` DOM CustomEvent channels (PLAN.md 0.4). Import
 * from here, never from `./bus` or `./registry` directly.
 *
 * `catalogue.ts` is here too, because "what does this command look like in the palette?" is part of the
 * same contract as "what does it carry?" — and because keeping the two behind one barrel is what stops
 * a surface reading the registry for ids and inventing its own labels for them.
 *
 * Six channels, not the nine the plan estimated: a walk of the Angular renderer found sixteen
 * distinct event names dispatched and exactly six with a listener anywhere — `menu-copy`,
 * `cursor-position`, `insert-snippet`, `show-shortcuts`, `open-object-search`, `open-snippets`. The
 * other ten are the palette's dead dispatches. `registry.ts` has the reasoning and the citations.
 */

export {
  dispatchCommand,
  handlerCount,
  subscribeCommand,
  useCommand,
  type CommandHandler,
  type PayloadCommandId,
  type PayloadlessCommandId,
} from './bus';
export {
  acceleratorKeysForPlatform,
  COMMAND_CATALOGUE,
  COMMAND_GROUP_LABELS,
  COMMAND_GROUPS,
  commandAccelerator,
  formatAccelerator,
  formatAcceleratorList,
  paletteCommandIds,
  type Accelerator,
  type AcceleratorKeys,
  type AcceleratorSource,
  type CatalogueEntry,
  type CommandDisplay,
  type CommandGroup,
  type HiddenFromPalette,
  type PaletteRequirement,
  type PaletteVisibility,
  type ShownInPalette,
} from './catalogue';
export {
  COMMAND_CONSUMERS,
  COMMAND_IDS,
  type CommandId,
  type CommandPayload,
  type CommandPayloads,
} from './registry';
