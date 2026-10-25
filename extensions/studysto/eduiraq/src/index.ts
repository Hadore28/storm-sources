// EduIraq (eduiraq.my), class of 2027. The site ships its catalog encrypted; this
// extension carries a decrypted copy (catalog.json, refreshed with a new version).
// A lecture is a Bunny video id, exchanged for a signed playlist at /api/video-token.

import { SourceError, defineExtension, type Context, type VideoServer } from "@storm-sources/sdk";
import { feedSource, videoKind, type Feed } from "../../feed";
import catalog from "./catalog.json";

const SITE = "https://eduiraq.my";
const SIGNAL = "edu-2027-nocache-x9f";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function signed(ctx: Context, guid: string) {
  const res = await ctx.http.json<{ url?: string; expires?: number }>(`${SITE}/api/video-token`, {
    query: { guid },
    headers: { Referer: `${SITE}/index.html`, "x-app-signal": SIGNAL, "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res?.url) throw new SourceError("changed", "EduIraq gave no video link");
  return res.url;
}

const eduiraq = feedSource({
  id: "eduiraq",
  name: "EduIraq",
  baseUrl: SITE,
  years: { "2027": async () => catalog as Feed },
  locked: (url) => url.toLowerCase() === "vip" || (!GUID.test(url) && !/^https?:\/\//.test(url)),
  async servers(ctx, url): Promise<VideoServer[]> {
    const target = GUID.test(url) ? await signed(ctx, url) : url;
    return [{ name: "EduIraq", url: target, kind: GUID.test(url) ? "hls" : videoKind(target), referer: `${SITE}/` }];
  },
});

// signed links expire, so a lecture's servers are asked for again after a few minutes
eduiraq.cache = { servers: 5 * 60_000 };

export default defineExtension({
  pkg: "storm.studysto.eduiraq",
  name: "EduIraq",
  version: "1.0.2",
  app: "studysto",
  sources: [eduiraq],
});
