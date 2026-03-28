import type { DispatchRequest, DispatchResponse, InternalProviderHandler } from "../types";

export const mobyHandler: InternalProviderHandler = {
  key: "moby",
  async execute(_req: DispatchRequest, _env: Env): Promise<DispatchResponse> {
    throw new Error("Moby handler not implemented yet");
  }
};
