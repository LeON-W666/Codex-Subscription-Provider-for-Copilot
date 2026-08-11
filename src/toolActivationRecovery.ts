import type {
  ToolActivationRetryDecision,
  ToolCapabilityCategory
} from "./toolCapabilities";
import type { BridgeResponse } from "./protocol";

export interface ToolActivationRecoveryPlan {
  readonly trigger: boolean;
  readonly prompt: string;
}

/**
 * Build the one-shot correction input without carrying user text, tool
 * arguments, file contents, or result text into the second model turn.
 */
export function planToolActivationRecovery(
  decision: ToolActivationRetryDecision,
  alreadyAttempted: boolean
): ToolActivationRecoveryPlan {
  const trigger = !alreadyAttempted && decision.shouldRetry;
  return {
    trigger,
    prompt: trigger
      ? buildToolActivationRecoveryPrompt(decision)
      : ""
  };
}

export function buildToolActivationRecoveryPrompt(
  decision: ToolActivationRetryDecision
): string {
  const categories: readonly ToolCapabilityCategory[] = decision.requestedCategories;
  const activators = decision.activators;
  return [
    "Re-evaluate the user's requested action for tool selection.",
    "The prior response was not an acceptable final answer because a matching supplied tool-group activator exists for the requested capability.",
    `REQUESTED_CAPABILITY_CATEGORIES_JSON: ${JSON.stringify(categories)}`,
    `MATCHING_SUPPLIED_ACTIVATORS_JSON: ${JSON.stringify(activators)}`,
    "Use only an exact tool name from AVAILABLE_TOOLS_JSON. Request the matching activator as a kind=tool_calls response; Copilot executes it.",
    "Do not invent a tool, execute anything yourself, include arguments for an unavailable tool, or return a claim that the capability is unavailable."
  ].join("\n");
}

/** The second validated response replaces the first only when a retry ran. */
export function selectToolActivationResponse(
  first: BridgeResponse,
  second: BridgeResponse | undefined
): BridgeResponse {
  return second ?? first;
}
