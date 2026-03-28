import { dispatchExternalProvider } from "./external";
import { dispatchInternalProvider } from "./internal";
import type { DispatchRequest, DispatchResponse } from "./types";

export async function dispatchProvider(
  req: DispatchRequest,
  env: Env
): Promise<DispatchResponse> {
  const callbackUrl = req.provider.callback_url;

  if (!callbackUrl) {
    throw new Error(`Provider ${req.provider.id} has no callback_url`);
  }

  if (callbackUrl.startsWith("internal://")) {
    return dispatchInternalProvider(req, env);
  }

  return dispatchExternalProvider(req, env);
}
