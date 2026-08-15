/**
 * The typed command bus, replacing the nine live `joinery:*` DOM CustomEvent channels (PLAN.md
 * 0.4). Import from here, never from `./bus` or `./registry` directly.
 */

export {
  dispatchCommand,
  handlerCount,
  subscribeCommand,
  useCommand,
  type CommandHandler,
} from './bus';
export {
  COMMAND_CONSUMERS,
  COMMAND_IDS,
  type CommandId,
  type CommandPayload,
  type CommandPayloads,
} from './registry';
