import type { DispatchRequest, DispatchResponse, InternalProviderHandler } from "../types";

export const piSignalsHandler: InternalProviderHandler = {
  key: "pi_signals",
  async execute(_req: DispatchRequest, _env: Env): Promise<DispatchResponse> {
    throw new Error("PI Signals handler not implemented yet");
  }
};
