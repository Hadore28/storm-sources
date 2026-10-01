import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

// Origins reached by IP fall over under bursts, so each IP gets a few requests at a time.
const PER_IP = 3;
const active = new Map<string, number>();
const waiting = new Map<string, (() => void)[]>();
const learned = new Map<string, string>();

async function acquire(ip: string) {
  if ((active.get(ip) ?? 0) < PER_IP) {
    active.set(ip, (active.get(ip) ?? 0) + 1);
    return;
  }
  await new Promise<void>((resolve) => waiting.set(ip, [...(waiting.get(ip) ?? []), resolve]));
}

function release(ip: string) {
  const next = waiting.get(ip)?.shift();
  if (next) next();
  else active.set(ip, (active.get(ip) ?? 1) - 1);
}

async function once(ip: string, url: URL, init: RequestInit): Promise<Response> {
  await acquire(ip);
  let released = false;
  let answered = false;
  const secure = url.protocol === "https:";
  return new Promise((resolve, reject) => {
    const done = () => {
      init.signal?.removeEventListener("abort", abort);
      if (!released) (released = true), release(ip);
    };
    const req = (secure ? httpsRequest : httpRequest)(
      {
        host: ip,
        port: url.port || (secure ? 443 : 80),
        path: url.pathname + url.search,
        method: init.method ?? "GET",
        headers: { ...Object.fromEntries(new Headers(init.headers)), host: url.host },
        // the certificate is for the hostname, and origins often let it lapse
        ...(secure ? { servername: url.hostname, rejectUnauthorized: false } : {}),
      },
      (res) => {
        answered = true;
        res.once("end", done);
        res.once("close", done);
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        const status = res.statusCode ?? 502;
        const empty = status === 204 || status === 304 || init.method === "HEAD";
        if (empty) res.resume();
        resolve(new Response(empty ? null : (Readable.toWeb(res) as unknown as ReadableStream), { status, headers }));
      },
    );
    const abort = () => req.destroy(init.signal?.reason ?? new Error("aborted"));
    init.signal?.addEventListener("abort", abort, { once: true });
    req.once("close", () => {
      if (!answered) done();
    });
    req.on("error", (e) => {
      done();
      reject(e);
    });
    req.end(typeof init.body === "string" ? init.body : undefined);
  });
}

/** fetch() that connects to one of `ips` instead of looking the host up; the IP that answers is remembered per host. */
export async function fetchVia(ips: string[], input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input);
  const known = learned.get(url.hostname);
  const order = known && ips.includes(known) ? [known, ...ips.filter((ip) => ip !== known)] : ips;
  let failed: Response | undefined;
  let error: unknown;
  for (const ip of order) {
    try {
      const res = await once(ip, url, init);
      if (res.status < 400) {
        learned.set(url.hostname, ip);
        return res;
      }
      failed = new Response(await res.text(), { status: res.status, headers: res.headers });
    } catch (e) {
      error = e;
    }
  }
  if (failed) return failed;
  throw error;
}
