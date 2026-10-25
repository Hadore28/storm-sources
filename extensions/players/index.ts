// Turns the video hosts sites embed into streams storm's own player can play.
// Most links are signed for the address that asked, so those carry a referer
// and storm's server streams them.

import type { Context, VideoServer } from "@storm-sources/sdk";
import { unpackAll } from "./unpack";

type Found = Omit<VideoServer, "name"> & { name?: string };
type Extractor = (ctx: Context, url: string) => Promise<Found[]>;

// the same agent storm's video proxy sends, for links tied to it
const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
// how many embeds one episode resolves, so a page of thirty mirrors stays quick
const MAX_RESOLVED = 16;

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const origin = (url: string) => `${new URL(url).origin}/`;
const page = (ctx: Context, url: string, referer?: string) =>
  ctx.http.request("GET", url, { headers: { "User-Agent": AGENT, ...(referer ? { Referer: referer } : {}) }, retries: 1 });
const kindOf = (url: string): Found["kind"] => (/\.m3u8(\?|$)|\/master\.txt(\?|$)/.test(url) ? "hls" : "mp4");
const abs = (url: string) => (url.startsWith("//") ? `https:${url}` : url);

const okru: Extractor = async (ctx, url) => {
  const id = /videoembed\/(\d+)|video\/(\d+)/.exec(url);
  if (!id) return [];
  const html = await ctx.http.text(`https://ok.ru/videoembed/${id[1] ?? id[2]}`, { headers: { "User-Agent": AGENT } });
  const raw = /data-options="([^"]+)"/.exec(html)?.[1];
  if (!raw) return [];
  const options = JSON.parse(unescape(raw)) as { flashvars?: { metadata?: unknown } };
  const meta = options.flashvars?.metadata;
  const m = (typeof meta === "string" ? JSON.parse(meta) : meta) as { hlsManifestUrl?: string; ondemandHls?: string; videos?: { name: string; url: string }[] } | undefined;
  const hls = m?.hlsManifestUrl ?? m?.ondemandHls;
  if (hls) return [{ url: hls, kind: "hls", referer: "https://ok.ru/" }];
  const best = m?.videos?.at(-1);
  return best ? [{ url: best.url, kind: "mp4", quality: best.name, referer: "https://ok.ru/" }] : [];
};

const vk: Extractor = async (ctx, url) => {
  const html = await ctx.http.text(url.replace("vkvideo.ru/", "vk.com/"), { headers: { "User-Agent": AGENT } });
  const hls = /"hls(?:_ondemand)?"\s*:\s*"([^"]+)"/.exec(html)?.[1];
  if (hls) return [{ url: JSON.parse(`"${hls}"`), kind: "hls", referer: "https://vk.com/" }];
  const mp4 = [...html.matchAll(/"url(\d{3,4})"\s*:\s*"([^"]+)"/g)].sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  return mp4 ? [{ url: JSON.parse(`"${mp4[2]}"`), kind: "mp4", quality: `${mp4[1]}p`, referer: "https://vk.com/" }] : [];
};

const rutube: Extractor = async (ctx, url) => {
  const u = new URL(url);
  const id = /\/embed\/([0-9a-f]{32})/.exec(u.pathname)?.[1];
  if (!id) return [];
  const p = u.searchParams.get("p");
  const data = await ctx.http.json<{ video_balancer?: { m3u8?: string } }>(`https://rutube.ru/api/play/options/${id}/?format=json${p ? `&p=${encodeURIComponent(p)}` : ""}`, {
    headers: { Referer: url },
  });
  const hls = data.video_balancer?.m3u8;
  return hls ? [{ url: hls, kind: "hls", referer: "https://rutube.ru/" }] : [];
};

const mp4upload: Extractor = async (ctx, url) => {
  const id = /mp4upload\.com\/(?:embed-)?([a-z0-9]{12})/i.exec(url)?.[1];
  if (!id) return [];
  const html = await (await page(ctx, `https://www.mp4upload.com/embed-${id}.html`)).text();
  const src = /src:\s*"(https?:\/\/[^"]+\.mp4[^"]*)"/.exec(html)?.[1];
  return src ? [{ url: src, kind: "mp4", referer: "https://www.mp4upload.com/" }] : [];
};

// Voe hides its sources in a JSON string: rot13, junk markers, base64, a shift of three, reversed, base64.
function voeDecode(raw: string): { source?: string; direct_access_url?: string } | undefined {
  try {
    let s = raw.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
    for (const junk of ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]) s = s.split(junk).join("");
    s = atob(s);
    s = [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).reverse().join("");
    return JSON.parse(atob(s));
  } catch {
    return undefined;
  }
}

const voe: Extractor = async (ctx, url) => {
  let res = await page(ctx, url);
  let html = await res.text();
  // the first page only sends the browser on to the day's domain
  const next = /window\.location\.href\s*=\s*'(https?:\/\/[^']+\/e\/[^']+)'/.exec(html)?.[1];
  if (next) {
    res = await page(ctx, next);
    html = await res.text();
  }
  const blob = /<script type="application\/json">\s*(\[[\s\S]*?\])\s*<\/script>/.exec(html)?.[1];
  const data = blob ? voeDecode(JSON.parse(blob)[0]) : undefined;
  const referer = origin(res.url || next || url);
  const out: Found[] = [];
  if (data?.source) out.push({ url: data.source, kind: "hls", referer });
  if (data?.direct_access_url) out.push({ url: data.direct_access_url, kind: "mp4", referer });
  return out;
};

const dood: Extractor = async (ctx, url) => {
  const embed = url.replace(/\/[de]\//, "/e/");
  const res = await page(ctx, embed);
  const html = await res.text();
  const pass = /\/pass_md5\/[^'"]+/.exec(html)?.[0];
  const token = /[?&]token=([a-z0-9]+)/i.exec(pass ?? "")?.[1] ?? /token=([a-z0-9]+)/i.exec(html)?.[1];
  if (!pass || !token) return [];
  const site = new URL(res.url || embed).origin;
  const base = (await (await page(ctx, `${site}${pass}`, res.url || embed)).text()).trim();
  if (!/^https?:\/\//.test(base)) return [];
  const tail = Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");
  return [{ url: `${base}${tail}?token=${token}&expiry=${Date.now()}`, kind: "mp4", referer: `${site}/` }];
};

const mixdrop: Extractor = async (ctx, url) => {
  const res = await page(ctx, url.replace(/\/f\//, "/e/"));
  const code = unpackAll(await res.text());
  const src = /MDCore\.wurl\s*=\s*"([^"]+)"/.exec(code)?.[1];
  return src ? [{ url: abs(src), kind: "mp4", referer: origin(res.url || url) }] : [];
};

// The jwplayer family (streamwish, filemoon, earnvids and their many domains).
const packed: Extractor = async (ctx, url) => {
  let res = await page(ctx, url);
  let html = await res.text();
  // XFileSharing hosts (uqload, savefiles) post a form to get the player
  if (/name="op" value="embed"/.test(html)) {
    const at = res.url || url;
    const code = at.replace(/\.html$/, "").split("/").pop()!.split("-").pop()!;
    res = await ctx.http.request("POST", `${new URL(at).origin}/dl`, {
      headers: { "User-Agent": AGENT, Referer: at },
      form: { op: "embed", file_code: code, auto: "1", referer: "" },
      retries: 1,
    });
    html = await res.text();
    res = { ...res, url: at };
  }
  const code = `${unpackAll(html)}\n${html}`;
  const referer = origin(res.url || url);
  const links = /links\s*=\s*(\{[^}]*\})/.exec(code)?.[1];
  if (links) {
    try {
      const o = JSON.parse(links) as Record<string, string>;
      // the order the host's own player tries them
      const pick = o.hls4 ?? o.hls3 ?? o.hls2;
      if (pick) return [{ url: pick.startsWith("/") ? new URL(pick, res.url || url).toString() : pick, kind: "hls", referer }];
    } catch {
      // fall through to a plain file
    }
  }
  const file = /(?:file|src)\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/.exec(code)?.[1];
  return file ? [{ url: file, kind: kindOf(file), referer }] : [];
};

// Streamtape writes its link as string pieces cut with .substring(); this reads them without running code.
function joinPieces(expr: string): string | undefined {
  let out = "";
  for (const part of expr.split(/\s*\+\s*(?=['"(])/)) {
    const m = /^\(?\s*(['"])(.*?)\1\s*\)?((?:\s*\.substring\(\s*\d+\s*\))*)\s*$/.exec(part.trim());
    if (!m) return undefined;
    let s = m[2];
    for (const cut of m[3].matchAll(/\.substring\(\s*(\d+)\s*\)/g)) s = s.substring(Number(cut[1]));
    out += s;
  }
  return out;
}

const streamtape: Extractor = async (ctx, url) => {
  const id = /streamtape\.[a-z.]+\/[ev]\/([\w-]+)/i.exec(url)?.[1];
  if (!id) return [];
  // its own domain: .com is blocked in some places where .to isn't
  const site = new URL(url).origin;
  const embed = `${site}/e/${id}/`;
  const html = await (await page(ctx, embed, `${site}/`)).text();
  let path: string | undefined;
  for (const m of html.matchAll(/getElementById\(['"](\w+)['"]\)\.innerHTML\s*=\s*([^;]+);/g)) {
    const v = joinPieces(m[2]);
    if (v?.includes("/get_video?id=")) path = v;
  }
  if (!path) return [];
  const getVideo = path.startsWith("http") ? path : `https:${path.startsWith("//") ? path : `//${path.replace(/^\//, "")}`}`;
  const hop = await ctx.http.request("GET", `${getVideo}&stream=1`, { headers: { "User-Agent": AGENT, Referer: embed }, redirect: "manual", retries: 0 });
  const cdn = hop.headers.location;
  return cdn && /^https?:\/\//.test(cdn) ? [{ url: cdn, kind: "mp4", referer: `${site}/` }] : [];
};

// MediaFire file pages carry the file's direct address on their download button.
const mediafire: Extractor = async (ctx, url) => {
  const res = await page(ctx, url);
  // a removed file sends the visitor to an error page
  if (/error\.php/.test(res.url)) return [];
  const html = await res.text();
  const scrambled = /data-scrambled-url="([^"]+)"/.exec(html)?.[1];
  let direct: string | undefined;
  if (scrambled) {
    try {
      const u = atob(scrambled);
      if (/^https?:\/\/download\d*\.mediafire\.com\//.test(u)) direct = u;
    } catch {
      // the plain link below
    }
  }
  direct ??= /href="(https?:\/\/download\d*\.mediafire\.com\/[^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
  // a zip or rar is a download, not something to play
  return direct && !/\.(zip|rar|7z)(\?|$)/i.test(direct) ? [{ url: direct, kind: "mp4" }] : [];
};

const pixeldrain: Extractor = async (_ctx, url) => {
  const id = /pixeldrain\.com\/(?:u|api\/file)\/([A-Za-z0-9]+)/.exec(url)?.[1];
  return id ? [{ url: `https://pixeldrain.com/api/file/${id}`, kind: "mp4" }] : [];
};

const fourshared: Extractor = async (ctx, url) => {
  const html = await (await page(ctx, url)).text();
  const src = /(https?:\/\/[a-z0-9]+\.4shared\.com\/img\/[^"'\s]+\/preview\.mp4)/.exec(html)?.[1];
  return src ? [{ url: src, kind: "mp4", referer: "https://www.4shared.com/" }] : [];
};

// Megamax lists every quality's copies on other hosts; storm plays the copies it can read.
const MEGAMAX_DRIVERS = new Set(["mp4upload", "voe", "mixdrop", "savefiles", "uqload", "earnvids", "streamwish", "filemoon", "vidhide", "dood", "doodstream"]);
const megamax: Extractor = async (ctx, url) => {
  const hash = /\/(?:iframe|e|d|f|download|mirror)\/([A-Za-z0-9]+)/.exec(url)?.[1];
  if (!hash) return [];
  const site = new URL(url).origin;
  const embed = `${site}/iframe/${hash}`;
  const html = await (await page(ctx, embed)).text();
  const data = /<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const version = data ? (JSON.parse(data) as { version?: string }).version : undefined;
  if (!version) return [];
  const res = await ctx.http.request("GET", embed, {
    headers: {
      "User-Agent": AGENT,
      Referer: embed,
      "X-Inertia": "true",
      "X-Inertia-Version": version,
      "X-Inertia-Partial-Component": "files/mirror/video",
      "X-Inertia-Partial-Data": "streams",
      "X-Requested-With": "XMLHttpRequest",
    },
    retries: 1,
  });
  type Stream = { label?: string; mirrors?: { driver?: string; link?: string }[] };
  const streams = ((await res.json()) as { props?: { streams?: { data?: Stream[] } } }).props?.streams?.data ?? [];
  const wanted = streams.flatMap((s) =>
    (s.mirrors ?? [])
      .filter((m) => m.link && MEGAMAX_DRIVERS.has((m.driver ?? "").toLowerCase()))
      .map((m) => ({ link: abs(m.link!), quality: /\d{3,4}p/.exec(s.label ?? "")?.[0] })),
  );
  // the best quality's copies first; a couple of hosts is plenty
  const out: Found[] = [];
  for (const w of wanted) {
    if (out.length) break;
    const host = hostFor(w.link);
    if (!host || host.get === megamax) continue;
    const got = await host.get(ctx, w.link).catch(() => [] as Found[]);
    out.push(...got.map((g) => ({ ...g, name: host.name, quality: g.quality ?? w.quality })));
  }
  return out;
};

// most dependable first: an episode resolves the first few it lists
const HOSTS: { name: string; match: RegExp; get: Extractor }[] = [
  { name: "Mp4upload", match: /^https?:\/\/(www\.)?mp4upload\.com\//, get: mp4upload },
  { name: "Voe", match: /^https?:\/\/(www\.)?voe\.sx\/(e\/)?[a-z0-9]+/i, get: voe },
  { name: "Uqload", match: /^https?:\/\/(www\.)?uqload\.[a-z]+\/(e\/|embed-)?[a-z0-9]{12}/i, get: packed },
  { name: "OK", match: /^https?:\/\/(www\.|m\.)?ok\.ru\/(videoembed|video)\//, get: okru },
  { name: "VK", match: /^https?:\/\/(vk\.com|vkvideo\.ru)\/video_ext\.php/, get: vk },
  { name: "Rutube", match: /^https?:\/\/rutube\.ru\/play\/embed\//, get: rutube },
  {
    name: "Streamwish",
    match: /^https?:\/\/(www\.)?(streamwish|swish|wishembed|wishfast|filemoon|moonplayer|earnvids|morencius|vidhide|vidhidepro|streamhg|hglink|dhtpre|smoothpre|playerwish|hlswish|kerapoxy)\.[a-z]+\/(e|v|f|embed)\//i,
    get: packed,
  },
  { name: "Mixdrop", match: /^https?:\/\/(www\.)?(mixdrop|mxdrop|mixdroop|m1xdrop|mixdrp)\.[a-z]+\/[ef]\//i, get: mixdrop },
  { name: "Megamax", match: /^https?:\/\/(www\.)?(megamax\.me|share4max\.com)\/(iframe|e|d|f|download)\//, get: megamax },
  { name: "MediaFire", match: /^https?:\/\/(www\.)?mediafire\.com\/file\//, get: mediafire },
  { name: "Pixeldrain", match: /^https?:\/\/(www\.)?pixeldrain\.com\/(u|api\/file)\//, get: pixeldrain },
  { name: "4shared", match: /^https?:\/\/(www\.)?4shared\.com\/(web\/)?embed\//, get: fourshared },
  { name: "Streamtape", match: /^https?:\/\/(www\.)?streamtape\.[a-z.]+\/[ev]\//i, get: streamtape },
  { name: "Dood", match: /^https?:\/\/(www\.)?(dood[a-z]*|d0+d|ds2play|dsvplay|playmogo|dooood|vide0|myvidplay)\.[a-z]+\/[de]\//i, get: dood },
  { name: "Savefiles", match: /^https?:\/\/(www\.)?savefiles\.com\/(e\/)?[a-z0-9]{12}/i, get: packed },
];

const hostFor = (url: string) => HOSTS.find((h) => h.match.test(url));

/** Whether storm can turn this embed into a direct stream. */
export const resolvable = (url: string) => !!hostFor(url);

/** The direct streams for an embedded player, or none when the host isn't one storm knows or doesn't answer. */
export async function direct(ctx: Context, url: string): Promise<VideoServer[]> {
  const host = hostFor(url);
  if (!host) return [];
  try {
    return (await host.get(ctx, url)).map((d) => ({ ...d, name: d.name ?? host.name }));
  } catch (e) {
    ctx.log("no direct stream", { url, error: String(e) });
    return [];
  }
}

/** The same servers in the same order; each one storm can read plays as a direct stream, the rest stay embeds. */
export async function withDirect(ctx: Context, servers: VideoServer[]): Promise<VideoServer[]> {
  let budget = MAX_RESOLVED;
  return Promise.all(
    servers.map(async (s) => {
      if (s.kind !== "embed" || s.download || !resolvable(s.url) || budget-- <= 0) return s;
      const [d] = await direct(ctx, s.url);
      return d ? { ...d, name: s.name, quality: s.quality ?? d.quality, audio: s.audio, lang: s.lang } : s;
    }),
  );
}
