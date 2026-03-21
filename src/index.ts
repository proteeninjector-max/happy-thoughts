type X402VerificationResult =
  | { ok: true; payer: string; amount: number; token: string; network: string }
  | { ok: false; response: Response };

const X402_HEADER = "x402-payment"; // expected JSON payload

export async function verifyX402Payment(
  request: Request,
  requiredAmount: number
): Promise<X402VerificationResult> {
  const raw = request.headers.get(X402_HEADER);
  if (!raw) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "payment_required",
          message: "x402 payment header missing",
          requiredAmount,
          token: "USDC",
          network: "Base",
          header: X402_HEADER
        }),
        { status: 402, headers: { "content-type": "application/json" } }
      )
    };
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "payment_required",
          message: "invalid x402 payment payload",
          requiredAmount,
          token: "USDC",
          network: "Base",
          header: X402_HEADER
        }),
        { status: 402, headers: { "content-type": "application/json" } }
      )
    };
  }

  const amount = Number(payload.amount);
  const token = String(payload.token || "USDC");
  const network = String(payload.network || "Base");
  const payer = String(payload.payer || payload.wallet || "");

  if (!payer || !Number.isFinite(amount) || amount < requiredAmount) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: "payment_required",
          message: "insufficient x402 payment",
          requiredAmount,
          token: "USDC",
          network: "Base",
          header: X402_HEADER
        }),
        { status: 402, headers: { "content-type": "application/json" } }
      )
    };
  }

  return { ok: true, payer, amount, token, network };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response("HappyThoughts worker scaffold", { status: 200 });
  }
};

export interface Env {
  PROVIDERS: KVNamespace;
  SCORES: KVNamespace;
  THOUGHTS: KVNamespace;
  CACHE: KVNamespace;
  BUNDLES: KVNamespace;
  BUYERS: KVNamespace;
  FEEDBACK: KVNamespace;
  FLAGS: KVNamespace;
  REFERRALS: KVNamespace;
  AGREEMENTS: KVNamespace;
  PROFIT_WALLET: string;
}
