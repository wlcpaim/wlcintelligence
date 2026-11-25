/**
 * WLC 1.1.0 System — módulo Owner isolado.
 * Ponto de entrada público do sistema cognitivo e da bridge.
 */

export { SYSTEM_VERSION, SYSTEM_GREETING, SYSTEM_INSTRUCTION, OWNER_CAPABILITIES } from "./identity";
export type { OwnerCapability } from "./identity";

export { plan, helpText, statusText } from "./core/cognitive";
export type { SystemIntent, CognitivePlan } from "./core/cognitive";

export { execute } from "./core/executor";
export type { ExecutionContext, ExecutionResult } from "./core/executor";

export { handleSystemMessage } from "./services/system-chat.server";
export type { SystemChatInput, SystemChatOutput } from "./services/system-chat.server";

export { handleBridgeCommand, bridgeCommandSchema } from "./bridge/command-bridge";
export type { BridgeCommand, BridgeResult } from "./bridge/command-bridge";
