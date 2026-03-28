import type { DispatchRequest, DispatchResponse, InternalHandlerKey, InternalProviderHandler } from "./types";

let internalHandlers: Partial<Record<InternalHandlerKey, InternalProviderHandler>> = {};

export function registerInternalHandlers(
  handlers: Record<InternalHandlerKey, InternalProviderHandler>
): void {
  internalHandlers = handlers;
}

export async function dispatchInternalByKey(
  key: InternalHandlerKey,
  req: DispatchRequest,
  env: Env
): Promise<DispatchResponse> {
  const handler = internalHandlers[key];

  if (!handler) {
    throw new Error(`No internal handler registered for ${key}`);
  }

  return handler.execute(req, env);
}
