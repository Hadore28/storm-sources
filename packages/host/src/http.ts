import { SourceError, type Cache, type Doc, type Http, type HttpResponse, type QueryValue, type RequestOptions } from "@storm-sources/sdk";
import { parseHtml } from "./html";
import type { RateLimiter } from "./rate-limit";

export type FetchLike = (input: string, init: RequestInit & { proxy?: string }) => Promise<Response>;

export interface HttpDeps {
  sourceId: string;
  headers: Record<string, string>;
  limiter?: RateLimiter;
  cache: Cache;
  fetch: FetchLike;
  proxy?: string;
}

interface Stored {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
}

const DEFAULT_TIMEOUT = 20_000;
const MAX_RETRY_WAIT = 10_000;

export function withQuery(url: string, query?: Record<string, QueryValue>) {
  if (!query) return url;
  const u = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    // arrays repeat the key as written, e.g. "includes[]"
    for (const v of Array.isArray(value) ? value : [value]) u.searchParams.append(key, String(v));
  }
  return u.toString();
}

function respond(s: Stored): HttpResponse {
  return {
    status: s.status,
    url: s.url,
    headers: s.headers,
    text: async () => s.body,
    async json<T>() {
      try {
        return JSON.parse(s.body) as T;
      } catch {
        throw new SourceError("changed", `Expected JSON from ${s.url}`, s.body.slice(0, 200));
      }
    },
  };
}

const CHALLENGE = /cf-chl|challenge-platform|Just a moment\.\.\.|Attention Required! \| Cloudflare|cf_chl_opt/;

/** Turns a non-2xx answer into the error kind the site, the admin and the reader can act on. */
export function statusError(s: Stored): SourceError {
  const where = new URL(s.url).host;
  if (s.status === 404 || s.status === 410) return new SourceError("not-found", `${where} has no such page`, s.url);
  if (s.status === 429) return new SourceError("rate-limited", `${where} is rate limiting us`);
  if (CHALLENGE.test(s.body) || s.status === 403) return new SourceError("blocked", `${where} blocked the request (${s.status})`);
  if (s.status >= 500) return new SourceError("network", `${where} is having trouble (${s.status})`);
  return new SourceError("network", `${where} answered ${s.status}`);
}

const shouldRetry = (status: number) => status === 429 || status === 408 || (status >= 500 && status <= 504);

export function createHttp(deps: HttpDeps): Http {
  async function attempt(method: string, url: string, opts: RequestOptions): Promise<Stored> {
    const headers: Record<string, string> = { ...deps.headers, ...opts.headers };
    let body: string | undefined = opts.body;
    if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers["Content-Type"] ??= "application/json";
    } else if (opts.form) {
      body = new URLSearchParams(opts.form).toString();
      headers["Content-Type"] ??= "application/x-www-form-urlencoded";
    }
    await deps.limiter?.acquire();
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method,
        headers,
        body,
        redirect: "follow",
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT),
        ...(deps.proxy ? { proxy: deps.proxy } : {}),
      });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new SourceError(timeout ? "timeout" : "network", `${new URL(url).host} ${timeout ? "took too long" : "could not be reached"}`, String(e));
    }
    return { status: res.status, url: res.url || url, headers: Object.fromEntries(res.headers), body: await res.text() };
  }

  async function request(method: "GET" | "POST", url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    const full = withQuery(url, opts.query);
    const cacheKey = method === "GET" && opts.cacheMs ? `http:${full}` : null;
    if (cacheKey) {
      const hit = await deps.cache.get<Stored>(cacheKey);
      if (hit) return respond(hit);
    }

    const retries = opts.retries ?? (method === "GET" ? 2 : 0);
    let last: Stored | SourceError | undefined;
    for (let i = 0; i <= retries; i++) {
      if (i > 0) {
        const after = last && !(last instanceof SourceError) ? Number(last.headers["retry-after"]) * 1000 : NaN;
        await Bun.sleep(Math.min(MAX_RETRY_WAIT, Number.isFinite(after) ? after : 400 * 2 ** i + Math.random() * 300));
      }
      try {
        last = await attempt(method, full, opts);
        if (!shouldRetry(last.status)) break;
      } catch (e) {
        last = e as SourceError;
      }
    }
    if (last instanceof SourceError) throw last;
    const stored = last!;
    if (cacheKey && stored.status >= 200 && stored.status < 300) await deps.cache.set(cacheKey, stored, opts.cacheMs!);
    return respond(stored);
  }

  async function ok(url: string, opts: RequestOptions & { method?: "GET" | "POST" } = {}) {
    const res = await request(opts.method ?? "GET", url, opts);
    if (res.status < 200 || res.status >= 300) {
      throw statusError({ status: res.status, url: res.url, headers: res.headers, body: await res.text() });
    }
    return res;
  }

  return {
    request,
    text: async (url, opts) => (await ok(url, opts)).text(),
    json: async (url, opts) => (await ok(url, opts)).json(),
    async doc(url, opts): Promise<Doc> {
      const res = await ok(url, opts);
      const html = await res.text();
      // Some sites serve a challenge page with a 200.
      if (CHALLENGE.test(html.slice(0, 4000))) throw new SourceError("blocked", `${new URL(res.url).host} served a bot check`);
      return parseHtml(html, res.url);
    },
  };
}
