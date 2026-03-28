import type { Env } from "../index";
import { dispatchInternalByKey, registerInternalHandlers } from "./executor";
import { claudeHaikuHandler } from "./handlers/claude-haiku";
import { mobyHandler } from "./handlers/moby";
import { piSignalsHandler } from "./handlers/pi-signals";
import { piThesisHandler } from "./handlers/pi-thesis";
import type { DispatchRequest, DispatchResponse, InternalHandlerKey, InternalProviderHandler } from "./types";

export const INTERNAL_HANDLERS: Record<InternalHandlerKey, InternalProviderHandler> = {
  pi_signals: piSignalsHandler,
  moby: mobyHandler,
  pi_thesis: piThesisHandler,
  claude_haiku: claudeHaikuHandler
};

registerInternalHandlers(INTERNAL_HANDLERS);

export function parseInternalCallback(callbackUrl: string): InternalHandlerKey | null {
  if (!callbackUrl.startsWith("internal://")) return null;

  const key = callbackUrl.slice("internal://".length) as InternalHandlerKey;
  return key in INTERNAL_HANDLERS ? key : null;
}

export async function dispatchInternalProvider(
  req: DispatchRequest,
  env: Env
): Promise<DispatchResponse> {
  const callbackUrl = req.provider.callback_url;

  if (!callbackUrl) {
    throw new Error(`Provider ${req.provider.id} has no callback_url`);
  }

  const key = parseInternalCallback(callbackUrl);
  if (!key) {
    throw new Error(`Invalid internal callback_url: ${callbackUrl}`);
  }

  return dispatchInternalByKey(key, req, env);
}
