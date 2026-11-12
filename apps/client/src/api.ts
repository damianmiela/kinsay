// The app's HTTP API: JSON in and out, our own cookies along. A failed request answers with its
// error code (network: "offline").
export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function api<T = object>(path: string, body?: unknown): Promise<Result<T>> {
  try {
    const r = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
    const json = (await r.json().catch(() => ({ ok: false, error: 'server' }))) as Result<T>;
    return json;
  } catch {
    return { ok: false, error: 'offline' };
  }
}
