import type { Env } from "../index";

export function getOwnerHeaders(env: Env): HeadersInit {
  const ownerHeader = env.OWNER_KEY_HEADER || "X-OWNER-KEY";
  const ownerKey = env.OWNER_KEY;
  return ownerKey ? { [ownerHeader]: ownerKey } : {};
}

export async function fetchJsonMaybe(url: string, env: Env): Promise<any | null> {
  try {
    const resp = await fetch(url, { headers: getOwnerHeaders(env) });
    const text = await resp.text();

    if (!resp.ok) {
      return {
        fetch_error: true,
        status: resp.status,
        statusText: resp.statusText,
        raw: text.slice(0, 500)
      };
    }

    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  } catch (error: any) {
    return {
      fetch_error: true,
      thrown: true,
      error: error?.message || String(error)
    };
  }
}
