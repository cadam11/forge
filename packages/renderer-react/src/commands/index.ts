/**
 * The typed command bus, replacing the `joinery:*` DOM CustomEvent channels (PLAN.md 0.4). Import
 * from here, never from `./bus` or `./registry` directly.
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
  COMMAND_CONSUMERS,
  COMMAND_IDS,
  type CommandId,
  type CommandPayload,
  type CommandPayloads,
} from './registry';
