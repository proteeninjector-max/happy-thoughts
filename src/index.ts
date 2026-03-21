export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response("HappyThoughts worker scaffold", { status: 200 });
  }
};

export interface Env {
  HT_KV: KVNamespace;
  PROFIT_WALLET: string;
}
