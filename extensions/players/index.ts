// Turns the video hosts sites embed into streams storm's own player can play.
// Most links are signed for the address that asked, so those carry a referer
// and storm's server streams them.

import type { Context, VideoServer } from "@storm-sources/sdk";
import { unpackAll } from "./unpack";

type Found = Omit<VideoServer, "name"> & { name?: string };
/** an extractor's way of saying the host plainly reports the video gone */
class Gone extends Error {}
type Extractor = (ctx: Context, url: string) => Promise<Found[]>;

// the same agent storm's video proxy sends, for links tied to it
const AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
// how many embeds one episode resolves, so a page of thirty mirrors stays quick
const MAX_RESOLVED = 16;
// a host that hangs stays an embed instead of holding up the whole list
const RESOLVE_MS = 8_000;

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const origin = (url: string) => `${new URL(url).origin}/`;
const page = (ctx: Context, url: string, referer?: string) =>
  ctx.http.request("GET", url, { headers: { "User-Agent": AGENT, ...(referer ? { Referer: referer } : {}) }, retries: 1, unlimited: true });
const kindOf = (url: string): Found["kind"] => (/\.m3u8(\?|$)|\/master\.txt(\?|$)/.test(url) ? "hls" : "mp4");
const abs = (url: string) => (url.startsWith("//") ? `https:${url}` : url);

const okru: Extractor = async (ctx, url) => {
  const id = /videoembed\/(\d+)|video\/(\d+)/.exec(url);
  if (!id) return [];
  const html = await ctx.http.text(`https://ok.ru/videoembed/${id[1] ?? id[2]}`, { headers: { "User-Agent": AGENT }, unlimited: true });
  if (/vp_video_stub/.test(html)) throw new Gone();
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
  const html = await ctx.http.text(url.replace(/\/\/(vkvideo\.ru|vk\.ru)\//, "//vk.com/"), { headers: { "User-Agent": AGENT }, unlimited: true });
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

// Firestream puts the file's signed address in a JSON block on its page.
const firestream: Extractor = async (ctx, url) => {
  const res = await page(ctx, url.replace(/\/(e|embed|v)\//, "/d/"));
  const html = await res.text();
  const raw = /<script id="video-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!raw) {
    if (/File Not Available/i.test(html)) throw new Gone();
    return [];
  }
  const v = (JSON.parse(raw) as { video?: { downloadUrl?: string; downloadAllowed?: boolean } }).video;
  if (!v?.downloadUrl) return [];
  return [{ url: v.downloadUrl.replace(/&download$/, ""), kind: "mp4" }];
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
      unlimited: true,
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
      // the order the host's own player tries them; some of these addresses are dead or badly signed
      const tries = [o.hls4, o.hls3, o.hls2].filter(Boolean).map((u) => (u.startsWith("/") ? new URL(u, res.url || url).toString() : u));
      for (const u of tries) {
        const ok = await page(ctx, u, referer).then((r) => r.status < 400, () => false);
        if (ok) return [{ url: u, kind: "hls", referer }];
      }
    } catch {
      // fall through to a plain file
    }
  }
  const file = /(?:file|src)\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/.exec(code)?.[1];
  return file ? [{ url: file, kind: kindOf(file), referer }] : [];
};

// a dead Streamwish mirror often still has the video on the main domains
const STREAMWISH_HOMES = ["streamwish.com", "niramirus.com", "medixiru.com"];
const streamwish: Extractor = async (ctx, url) => {
  const first = await packed(ctx, url).catch(() => [] as Found[]);
  if (first.length) return first;
  const id = /\/[efdv]\/([a-zA-Z0-9]+)/.exec(url)?.[1];
  for (const home of id ? STREAMWISH_HOMES : []) {
    if (new URL(url).hostname.endsWith(home)) continue;
    const got = await packed(ctx, `https://${home}/e/${id}`).catch(() => [] as Found[]);
    if (got.length) return got;
  }
  return [];
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
  // .com is blocked in some places where .to isn't
  let site = new URL(url).origin;
  let res = await page(ctx, `${site}/e/${id}/`, `${site}/`).catch(() => undefined);
  if (!res || res.status !== 200) {
    site = "https://streamtape.to";
    res = await page(ctx, `${site}/e/${id}/`, `${site}/`);
  }
  const embed = `${site}/e/${id}/`;
  const html = await res.text();
  let path: string | undefined;
  for (const m of html.matchAll(/getElementById\(['"](\w+)['"]\)\.innerHTML\s*=\s*([^;]+);/g)) {
    const v = joinPieces(m[2]);
    if (v?.includes("/get_video?id=")) path = v;
  }
  if (!path) return [];
  const getVideo = path.startsWith("http") ? path : `https:${path.startsWith("//") ? path : `//${path.replace(/^\//, "")}`}`;
  const hop = await ctx.http.request("GET", `${getVideo}&stream=1`, { unlimited: true, headers: { "User-Agent": AGENT, Referer: embed }, redirect: "manual", retries: 0 });
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
  // a browser playing it from another site is "hotlinking" (paid accounts only), so storm's server streams it
  return id ? [{ url: `https://pixeldrain.com/api/file/${id}`, kind: "mp4", referer: "https://pixeldrain.com/" }] : [];
};

const fourshared: Extractor = async (ctx, url) => {
  const html = await (await page(ctx, url)).text();
  if (/class="error4shared"/.test(html)) throw new Gone();
  const src = /(https?:\/\/[a-z0-9]+\.4shared\.com\/img\/[^"'\s]+\/preview\.mp4)/.exec(html)?.[1];
  return src ? [{ url: src, kind: "mp4", referer: "https://www.4shared.com/" }] : [];
};

// Megamax lists every quality's copies on other hosts; storm plays the copies it can read.
const MEGAMAX_DRIVERS = new Set(["mp4upload", "voe", "mixdrop", "savefiles", "uqload", "earnvids", "streamwish", "filemoon", "vidhide"]);
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

const dailymotion: Extractor = async (ctx, url) => {
  const u = new URL(url);
  const id = u.searchParams.get("video") ?? /\/(?:embed\/)?video\/([a-z0-9]+)/i.exec(u.pathname)?.[1] ?? (u.hostname === "dai.ly" ? u.pathname.slice(1) : undefined);
  if (!id) return [];
  const m = await ctx.http.json<{ qualities?: { auto?: { url: string }[] }; error?: { type?: string } }>(`https://www.dailymotion.com/player/metadata/video/${id}`, {
    query: { locale: "en-US" },
    headers: { "User-Agent": AGENT, Referer: "https://www.dailymotion.com/" },
  });
  if (m.error?.type === "not_found" || m.error?.type === "deleted") throw new Gone();
  const hls = m.qualities?.auto?.[0]?.url;
  return hls ? [{ url: hls, kind: "hls", referer: "https://www.dailymotion.com/" }] : [];
};

// Dood only gives /pass_md5/ to pages it trusts (phones usually); otherwise it stays an embed.
const dood: Extractor = async (ctx, url) => {
  const res = await page(ctx, url.replace(/\/[dfv]\//, "/e/"));
  const at = res.url || url;
  const html = await res.text();
  const pass = /'(\/pass_md5\/[^']+)'/.exec(html)?.[1];
  if (!pass) return [];
  const site = new URL(at).origin;
  const start = (await (await page(ctx, site + pass, at)).text()).trim();
  if (!/^https?:\/\//.test(start)) return [];
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const noise = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const quality = /\d{3,4}p/.exec(/<title>([^<]*)/.exec(html)?.[1] ?? "")?.[0];
  return [{ url: `${start}${noise}?token=${pass.split("/").pop()}&expiry=${Date.now()}`, kind: "mp4", referer: `${site}/`, quality }];
};

const sibnet: Extractor = async (ctx, url) => {
  const res = await page(ctx, url);
  const src = /player\.src\(\[\{\s*src:\s*"([^"]+)"/.exec(await res.text())?.[1];
  return src ? [{ url: new URL(src, res.url || url).toString(), kind: "mp4", referer: url }] : [];
};

// Yonaplay's SoraPlay, on WitAnime: a sources list that only answers with its referer
const soraplay: Extractor = async (ctx, url) => {
  const html = await (await page(ctx, url, "https://yonaplay.org/")).text();
  const list = /sources:\s*\[([\s\S]*?)\]/.exec(html)?.[1] ?? "";
  const files = [...list.matchAll(/"file"\s*:\s*"([^"]+)"(?:[^}]*"label"\s*:\s*"([^"]*)")?/g)];
  return files.map((m) => ({ url: m[1].replace(/\\\//g, "/"), kind: kindOf(m[1]), quality: m[2] || undefined, referer: "https://yonaplay.org/" }));
};

const vidyard: Extractor = async (ctx, url) => {
  const id = /vidyard\.com\/(?:watch\/|embed\/v4\/)?([\w-]+)/.exec(url)?.[1];
  if (!id) return [];
  const data = await ctx.http.json<{ payload?: { chapters?: { sources?: { hls?: { url: string; profile?: string }[]; mp4?: { url: string; profile?: string }[] } }[] } }>(
    `https://play.vidyard.com/player/${id}.json`,
    { headers: { Referer: "https://play.vidyard.com/" } },
  );
  const src = data.payload?.chapters?.[0]?.sources;
  const hls = src?.hls?.find((h) => /auto/i.test(h.profile ?? "")) ?? src?.hls?.[0];
  if (hls) return [{ url: hls.url, kind: "hls", referer: "https://play.vidyard.com/" }];
  const mp4 = src?.mp4?.at(-1);
  return mp4 ? [{ url: mp4.url, kind: "mp4", quality: mp4.profile, referer: "https://play.vidyard.com/" }] : [];
};

const rumble: Extractor = async (_ctx, url) => {
  const id = /rumble\.com\/embed\/v([a-z0-9]+)/i.exec(url)?.[1];
  return id ? [{ url: `https://rumble.com/hls-vod/${id}/playlist.m3u8`, kind: "hls", referer: "https://rumble.com/" }] : [];
};

// cda.pl scrambles its file address; this is the site's own unscrambling
function cdaFile(a: string): string {
  let s = a;
  for (const p of ["_XDDD", "_CDA", "_ADC", "_CXD", "_QWE", "_Q5", "_IKSDE"]) s = s.split(p).join("");
  s = [...decodeURIComponent(s)].map((c) => (c.charCodeAt(0) >= 33 && c.charCodeAt(0) <= 126 ? String.fromCharCode(33 + ((c.charCodeAt(0) + 14) % 94)) : c)).join("");
  s = s.replace(".cda.mp4", "").replace(".2cda.pl", ".cda.pl").replace(".3cda.pl", ".cda.pl");
  return s.includes("/upstream") ? `https://${s.replace("/upstream", ".mp4/upstream")}` : `https://${s}.mp4`;
}
const cda: Extractor = async (ctx, url) => {
  const html = await (await page(ctx, url)).text();
  if (/Materiał na który wskazywał ten link został usunięty/.test(html)) throw new Gone();
  const raw = /player_data="([^"]+)"/.exec(html)?.[1] ?? /player_data='([^']+)'/.exec(html)?.[1];
  if (!raw) return [];
  const v = (JSON.parse(unescape(raw)) as { video?: { file?: string; quality?: string; manifest_apple?: string } }).video;
  if (v?.manifest_apple) return [{ url: v.manifest_apple, kind: "hls", referer: "https://ebd.cda.pl/" }];
  return v?.file ? [{ url: cdaFile(v.file), kind: "mp4", quality: v.quality, referer: "https://www.cda.pl/" }] : [];
};

const BLOGGER_FORMAT: Record<string, string> = { "7": "240p", "18": "360p", "22": "720p", "37": "1080p" };
const blogger: Extractor = async (ctx, url) => {
  const html = await (await page(ctx, url)).text();
  if (/errorContainer/.test(html)) throw new Gone();
  const streams = /"streams":\[([\s\S]*?)\]/.exec(html)?.[1] ?? "";
  const found = [...streams.matchAll(/"play_url":"([^"]+)"[^}]*?"format_id":(\d+)/g)].map((m) => ({ url: JSON.parse(`"${m[1]}"`) as string, q: BLOGGER_FORMAT[m[2]] }));
  const best = found.at(-1);
  return best ? [{ url: best.url, kind: "mp4", quality: best.q, referer: "https://www.blogger.com/" }] : [];
};

// a shared Drive file plays from its download address; big files add a confirm form first
const gdrive: Extractor = async (ctx, url) => {
  const id = /\/file\/d\/([\w-]+)|[?&]id=([\w-]+)/.exec(url);
  const file = id?.[1] ?? id?.[2];
  if (!file) return [];
  const direct = `https://drive.usercontent.google.com/download?id=${file}&export=download`;
  const res = await ctx.http.request("GET", direct, { headers: { "User-Agent": AGENT }, retries: 0, unlimited: true, redirect: "manual" });
  const type = res.headers["content-type"] ?? "";
  if (!/text\/html/.test(type)) return [{ url: direct, kind: "mp4", referer: "https://drive.google.com/" }];
  const html = await res.text();
  if (/does not exist|not found|Sorry, the file/i.test(html)) throw new Gone();
  const params = new URLSearchParams();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) params.set(m[1], m[2]);
  if (!params.has("id")) return [];
  return [{ url: `https://drive.usercontent.google.com/download?${params}`, kind: "mp4", referer: "https://drive.google.com/" }];
};

// AnimePahe's Kwik: the playlist sits in one of several packed scripts
const kwik: Extractor = async (ctx, url) => {
  const html = await (await page(ctx, url, "https://animepahe.si/")).text();
  const code = unpackAll(html);
  const src = /(?:const|var)\s+source\s*=\s*\\?['"](https?:[^'"\\]+\.m3u8[^'"\\]*)/.exec(code)?.[1] ?? /(https?:\/\/[^'"\s\\]+\.m3u8[^'"\s\\]*)/.exec(code)?.[1];
  return src ? [{ url: src, kind: "hls", referer: "https://kwik.cx/" }] : [];
};

// Most small hosts (Sibnet, Sendvid, VidBom, Vudeo, YourUpload...) name the file next to a player key.
const FILE_AT = /\b(?:file|src|hls\d?|source|video_?url|playlist)["']?\s*[:=]\s*\[?\s*["']((?:https?:)?\/\/[^"'\s]+?\.(?:m3u8|mp4)(?:\?[^"'\s]*)?|\/[^"'\s]+?\.(?:m3u8|mp4)(?:\?[^"'\s]*)?)["']/gi;
const generic: Extractor = async (ctx, url) => {
  const res = await page(ctx, url);
  if (res.status >= 400) return [];
  const html = await res.text();
  const at = res.url || url;
  const code = `${unpackAll(html)}\n${html}`;
  const found = [...code.matchAll(FILE_AT), ...code.matchAll(/<source[^>]+src=["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi)]
    .map((m) => new URL(abs(unescape(m[1])), at).toString())
    .filter((u) => !/thumb|preview|poster|\/ads?\//i.test(u));
  const best = found.find((u) => kindOf(u) === "hls") ?? found[0];
  return best ? [{ url: best, kind: kindOf(best), referer: origin(at) }] : [];
};
// pages the general reader can't play: paid lockers, YouTube
const NOT_GENERIC = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com|mega\.nz|1fichier\.com|rapidgator\.net|nitroflare\.com|uptobox\.[a-z]+|facebook\.com|google\.com|gofile\.io)\//i;

// most dependable first: an episode resolves the first few it lists
const HOSTS: { name: string; match: RegExp; get: Extractor }[] = [
  { name: "Mp4upload", match: /^https?:\/\/(www\.)?mp4upload\.com\//, get: mp4upload },
  { name: "Voe", match: /^https?:\/\/(www\.)?voe\.sx\/(e\/)?[a-z0-9]+/i, get: voe },
  { name: "Uqload", match: /^https?:\/\/(www\.)?uqload\.[a-z]+\/(e\/|embed-)?[a-z0-9]{12}/i, get: packed },
  { name: "OK", match: /^https?:\/\/(www\.|m\.)?ok\.ru\/(videoembed|video)\//, get: okru },
  { name: "VK", match: /^https?:\/\/(vk\.com|vk\.ru|vkvideo\.ru)\/video_ext\.php/, get: vk },
  { name: "Rutube", match: /^https?:\/\/rutube\.ru\/play\/embed\//, get: rutube },
  {
    name: "Streamwish",
    match: /^https?:\/\/(www\.)?(streamwish|swish|wishembed|wishfast|playerwish|hlswish|niramirus|medixiru|swhoi|wishonly|streamwish\w*|sfastwish|obeywish|awish|dwish|mwish|strwish|cdnwish|flaswish|embedwish|jodwish|asnwish|egsyxurh|kswplayer|swdyu|ghbrisk|iplayerhls)\.[a-z]+\/(e|v|f|d|embed)\//i,
    get: streamwish,
  },
  {
    name: "Filemoon",
    match: /^https?:\/\/(www\.)?(filemoon|moonplayer|earnvids|morencius|vidhide|vidhidepro|vidhidevip|vidhideplus|streamhg|hglink|hgcloud|dhtpre|smoothpre|kerapoxy|filelions|alions|dlions|mlions|lylxan|callistanise|minochinos|movearnpre|dinisglows|mivalyo|dingtezuni|ryderjet)\.[a-z]+\/(e|v|f|d|embed|file)\//i,
    get: packed,
  },
  { name: "Sibnet", match: /^https?:\/\/video\.sibnet\.ru\/(shell\.php|video)/i, get: sibnet },
  { name: "SoraPlay", match: /^https?:\/\/([a-z0-9-]+\.)?(yonaplay|soraplay)\.[a-z]+\//i, get: soraplay },
  { name: "VidYard", match: /^https?:\/\/(play|video|share)\.vidyard\.com\//i, get: vidyard },
  { name: "Rumble", match: /^https?:\/\/(www\.)?rumble\.com\/embed\/v/i, get: rumble },
  { name: "CDA", match: /^https?:\/\/(www\.|ebd\.)?cda\.pl\/(video|[0-9a-z]+x[0-9]+\/)?/i, get: cda },
  { name: "Blogger", match: /^https?:\/\/(www\.)?blogger\.com\/video\.g\?/i, get: blogger },
  { name: "Drive", match: /^https?:\/\/(drive|docs)\.google\.com\/(file\/d\/|uc\?|open\?)/i, get: gdrive },
  { name: "Kwik", match: /^https?:\/\/(www\.)?kwik\.[a-z]+\/e\//i, get: kwik },
  { name: "Vidmoly", match: /^https?:\/\/(www\.)?vidmoly\.[a-z]+\/(e\/|embed-)?[a-z0-9]{12}/i, get: packed },
  { name: "1vid", match: /^https?:\/\/(www\.)?1vid\.[a-z]+\/(e\/|embed-)?[a-z0-9]{12}/i, get: packed },
  { name: "Mixdrop", match: /^https?:\/\/(www\.)?(mixdrop|mxdrop|mixdroop|m1xdrop|mixdrp)\.[a-z]+\/[ef]\//i, get: mixdrop },
  { name: "Megamax", match: /^https?:\/\/(www\.)?(megamax\.me|share4max\.com)\/(iframe|e|d|f|download)\//, get: megamax },
  { name: "Lulu", match: /^https?:\/\/(www\.)?(luluvdo|lulustream|luluvid|lulu)\.[a-z]+\/(e|d|v)\//i, get: packed },
  { name: "Dailymotion", match: /^https?:\/\/(www\.)?(dailymotion\.com\/(embed\/)?video\/|dailymotion\.com\/player|geo\.dailymotion\.com\/player|dai\.ly\/)/i, get: dailymotion },
  { name: "MediaFire", match: /^https?:\/\/(www\.)?mediafire\.com\/file\//, get: mediafire },
  { name: "Firestream", match: /^https?:\/\/(www\.)?firestream\.to\/(d|e|v|embed)\/[\w-]+/i, get: firestream },
  { name: "Pixeldrain", match: /^https?:\/\/(www\.)?pixeldrain\.com\/(u|api\/file)\//, get: pixeldrain },
  { name: "4shared", match: /^https?:\/\/(www\.)?4shared\.com\/(web\/)?embed\//, get: fourshared },
  { name: "Streamtape", match: /^https?:\/\/(www\.)?streamtape\.[a-z.]+\/[ev]\//i, get: streamtape },
  { name: "Savefiles", match: /^https?:\/\/(www\.)?savefiles\.com\/(e\/)?[a-z0-9]{12}/i, get: packed },
  { name: "Dood", match: /^https?:\/\/(www\.)?(dood[a-z]*|d0+d|d0o0d|d000d|ds2play|ds2video|dsvplay|playmogo|vidply|dooood|doods)\.[a-z]+\/[defv]\//i, get: dood },
  // Megamax moves to new domains; its pages give it away
  { name: "Megamax", match: /^https?:\/\/[^/]+\/iframe\/[A-Za-z0-9]{10,}\/?$/, get: megamax },
  { name: "Server", match: /^https?:\/\//, get: generic },
];

const hostFor = (url: string) => HOSTS.find((h) => h.match.test(url) && !(h.get === generic && NOT_GENERIC.test(url)));

/** Whether storm can turn this embed into a direct stream. */
export const resolvable = (url: string) => !!hostFor(url);

// what hosts show in place of a deleted video
const GONE = /(video|file)\s+(was\s+|has\s+been\s+)?(not\s+found|deleted|removed)|can.t\s+find\s+the\s+video|no\s+longer\s+available|(doesn't|does\s+not)\s+exist|file\s+is\s+unavailable|не\s+найден|был\s+удал[её]н|error4shared|errno=\d+/i;

// Asked only after a host gave no stream, so a working player is never written off.
async function gone(ctx: Context, url: string): Promise<boolean> {
  try {
    const res = await page(ctx, url);
    if (res.status === 404 || res.status === 410 || /error\.php/.test(res.url)) return true;
    const visible = (await res.text()).replace(/<(script|style)[\s\S]*?<\/>/gi, " ").replace(/<[^>]+>/g, " ");
    return GONE.test(visible.slice(0, 20_000));
  } catch {
    return false;
  }
}

/** The direct streams for an embedded player, or none when the host isn't one storm knows or doesn't answer. */
export async function direct(ctx: Context, url: string): Promise<VideoServer[]> {
  return (await read(ctx, url)).streams;
}

async function read(ctx: Context, url: string): Promise<{ streams: VideoServer[]; gone: boolean }> {
  const host = hostFor(url);
  if (!host) return { streams: [], gone: false };
  try {
    const streams = (await host.get(ctx, url)).map((d) => ({ ...d, name: d.name ?? host.name }));
    return { streams, gone: !streams.length && (await gone(ctx, url)) };
  } catch (e) {
    if (e instanceof Gone) return { streams: [], gone: true };
    ctx.log("no direct stream", { url, error: String(e) });
    return { streams: [], gone: false };
  }
}

/** The same servers in the same order; each one storm can read plays as a direct stream, a deleted one is marked, the rest stay embeds. */
export async function withDirect(ctx: Context, servers: VideoServer[]): Promise<VideoServer[]> {
  let budget = MAX_RESOLVED;
  return Promise.all(
    servers.map(async (s) => {
      if (s.kind !== "embed" || s.download || !resolvable(s.url) || budget-- <= 0) return s;
      const late = new Promise<{ streams: VideoServer[]; gone: boolean }>((done) => setTimeout(() => done({ streams: [], gone: false }), RESOLVE_MS));
      const { streams, gone } = await Promise.race([read(ctx, s.url), late]);
      const [d] = streams;
      if (d) return { ...d, name: s.name, quality: s.quality ?? d.quality, audio: s.audio, lang: s.lang };
      return gone ? { ...s, unavailable: true } : s;
    }),
  );
}
