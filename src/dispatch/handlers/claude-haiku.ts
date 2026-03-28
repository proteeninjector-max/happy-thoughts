import type { DispatchRequest, DispatchResponse, InternalProviderHandler } from "../types";

export const claudeHaikuHandler: InternalProviderHandler = {
  key: "claude_haiku",
  async execute(_req: DispatchRequest, _env: Env): Promise<DispatchResponse> {
    throw new Error("Claude Haiku handler not implemented yet");
  }
};
