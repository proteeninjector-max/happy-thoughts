import type { Env } from "../index";
import type { DispatchRequest, DispatchResponse } from "./types";

export async function dispatchExternalProvider(
  req: DispatchRequest,
  _env: Env
): Promise<DispatchResponse> {
  throw new Error(
    `External provider dispatch not implemented yet for provider ${req.provider.id} (${req.provider.callback_url ?? "no callback_url"})`
  );
}
