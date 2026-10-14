import type { FastifyInstance, InjectOptions } from "fastify";

/**
 * A `fetch` that answers from the app itself (`app.inject`) instead of the network, so the
 * typed `@portfolio/api-client` can call this API in-process. Each call still runs the full
 * plugin chain — auth, per-credential rate limit, the read-only-token gate — exactly like an
 * external request carrying the same Authorization header.
 */
export function injectFetch(app: FastifyInstance): typeof fetch {
  return async (input, init) => {
    const res = await app.inject({
      method: (init?.method ?? "GET") as InjectOptions["method"],
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      payload: typeof init?.body === "string" ? init.body : undefined,
    });
    const headers = new Headers();
    for (const [key, value] of Object.entries(res.headers)) {
      if (Array.isArray(value)) for (const v of value) headers.append(key, v);
      else if (value !== undefined) headers.set(key, String(value));
    }
    // 204/304 must not carry a body in a WHATWG Response.
    const bodyless = res.statusCode === 204 || res.statusCode === 304;
    return new Response(bodyless ? null : res.body, { status: res.statusCode, headers });
  };
}
