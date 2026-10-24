// Turns the video hosts lecture sites embed into streams storm's own player can play.
// Their links are signed for the address that asked, so storm's server streams them.

import type { Context, VideoServer } from "@storm-sources/sdk";

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function okru(ctx: Context, url: string): Promise<Omit<VideoServer, "name">[]> {
  const id = /videoembed\/(\d+)/.exec(url)?.[1];
  if (!id) return [];
  const page = await ctx.http.text(`https://ok.ru/videoembed/${id}`);
  const raw = /data-options="([^"]+)"/.exec(page)?.[1];
  if (!raw) return [];
  const options = JSON.parse(unescape(raw)) as { flashvars?: { metadata?: unknown } };
  const meta = options.flashvars?.metadata;
  const m = (typeof meta === "string" ? JSON.parse(meta) : meta) as { hlsManifestUrl?: string; ondemandHls?: string; videos?: { name: string; url: string }[] } | undefined;
  const hls = m?.hlsManifestUrl ?? m?.ondemandHls;
  if (hls) return [{ url: hls, kind: "hls", referer: "https://ok.ru/" }];
  const best = m?.videos?.at(-1);
  return best ? [{ url: best.url, kind: "mp4", quality: best.name, referer: "https://ok.ru/" }] : [];
}

async function vk(ctx: Context, url: string): Promise<Omit<VideoServer, "name">[]> {
  const page = await ctx.http.text(url.replace("vkvideo.ru/", "vk.com/"));
  const hls = /"hls(?:_ondemand)?"\s*:\s*"([^"]+)"/.exec(page)?.[1];
  if (hls) return [{ url: JSON.parse(`"${hls}"`), kind: "hls", referer: "https://vk.com/" }];
  const mp4 = [...page.matchAll(/"url(\d{3,4})"\s*:\s*"([^"]+)"/g)].sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  return mp4 ? [{ url: JSON.parse(`"${mp4[2]}"`), kind: "mp4", quality: `${mp4[1]}p`, referer: "https://vk.com/" }] : [];
}

async function rutube(ctx: Context, url: string): Promise<Omit<VideoServer, "name">[]> {
  const u = new URL(url);
  const id = /\/embed\/([0-9a-f]{32})/.exec(u.pathname)?.[1];
  if (!id) return [];
  const p = u.searchParams.get("p");
  const data = await ctx.http.json<{ video_balancer?: { m3u8?: string } }>(`https://rutube.ru/api/play/options/${id}/?format=json${p ? `&p=${encodeURIComponent(p)}` : ""}`, {
    headers: { Referer: url },
  });
  const hls = data.video_balancer?.m3u8;
  return hls ? [{ url: hls, kind: "hls", referer: "https://rutube.ru/" }] : [];
}

const HOSTS: [RegExp, string, (ctx: Context, url: string) => Promise<Omit<VideoServer, "name">[]>][] = [
  [/^https?:\/\/(www\.)?ok\.ru\/videoembed\//, "OK", okru],
  [/^https?:\/\/(vk\.com|vkvideo\.ru)\/video_ext\.php/, "VK", vk],
  [/^https?:\/\/rutube\.ru\/play\/embed\//, "Rutube", rutube],
];

/** The direct streams for an embedded player, or none when the host isn't one storm knows or doesn't answer. */
export async function direct(ctx: Context, url: string): Promise<VideoServer[]> {
  const host = HOSTS.find(([re]) => re.test(url));
  if (!host) return [];
  try {
    return (await host[2](ctx, url)).map((d) => ({ ...d, name: host[1] }));
  } catch (e) {
    ctx.log("no direct stream", { url, error: String(e) });
    return [];
  }
}

/** Each server's direct stream first, then the embeds as a fallback. */
export async function withDirect(ctx: Context, servers: VideoServer[]): Promise<VideoServer[]> {
  const found = await Promise.all(servers.map((s) => (s.kind === "embed" ? direct(ctx, s.url) : [])));
  return [...found.flat(), ...servers];
}
