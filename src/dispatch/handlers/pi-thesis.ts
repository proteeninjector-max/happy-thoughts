import { dispatchInternalByKey } from "../executor";
import type { DispatchRequest, DispatchResponse, ProviderRecord, InternalProviderHandler } from "../types";

function buildComposedProvider(base: ProviderRecord, id: ProviderRecord["id"], callback_url: string): ProviderRecord {
  return {
    ...base,
    id,
    callback_url
  };
}

export const piThesisHandler: InternalProviderHandler = {
  key: "pi_thesis",
  async execute(req: DispatchRequest, env: Env): Promise<DispatchResponse> {
    const signalProvider = buildComposedProvider(req.provider, "pi_signals", "internal://pi_signals");
    const mobyProvider = buildComposedProvider(req.provider, "moby_dick", "internal://moby");

    await dispatchInternalByKey(
      "pi_signals",
      {
        ...req,
        provider: signalProvider,
        specialty: "trading/signals"
      },
      env
    );

    await dispatchInternalByKey(
      "moby",
      {
        ...req,
        provider: mobyProvider,
        specialty: "crypto/whale-tracking"
      },
      env
    );

    throw new Error("PI Thesis handler not implemented yet");
  }
};
