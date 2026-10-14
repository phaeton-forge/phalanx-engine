export { defineGame } from './defineGame.js';
export { rejectCommand, isCommandRejection } from './commands.js';
export type {
  JsonValue,
  GameCommand,
  StampedCommand,
  CommandRejection,
  CommandSchema,
  CommandEnvelope,
  WireCommand,
} from './commands.js';
export type {
  SimMode,
  BotHostSide,
  HumanSlotConfig,
  BotSlotConfig,
  SlotConfig,
  MatchConfigBase,
  SlotInfo,
  BotSlotInfo,
} from './MatchConfig.js';
export type {
  WorldInitContext,
  SimWorld,
  MatchOutcome,
  MatchOutcomeWin,
  MatchOutcomeDraw,
  GameDefinition,
  AnyGameDefinition,
  ConfigOf,
  CommandOf,
  SimOf,
} from './GameDefinition.js';
