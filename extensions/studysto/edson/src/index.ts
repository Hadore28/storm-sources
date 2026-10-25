// Edson: one public JSON feed per class year; lectures are files, playlists or player pages.

import { defineExtension, type Context, type VideoServer } from "@storm-sources/sdk";
import { feedSource, videoKind, type Feed } from "../../feed";

const SITE = "https://edson.my";
const FEEDS: Record<string, string> = { "2026": `${SITE}/mm.json`, "2025": `${SITE}/ss.json` };

const feed = (url: string) => (ctx: Context) => ctx.http.json<Feed>(url, { cacheMs: 30 * 60_000 });

function host(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

const edson = feedSource({
  id: "edson",
  name: "Edson",
  baseUrl: SITE,
  years: Object.fromEntries(Object.entries(FEEDS).map(([y, u]) => [y, feed(u)])),
  // the feed marks paid lectures with a short code instead of a link
  locked: (url) => url.length <= 5 || /\/None$/.test(url),
  async servers(_ctx, url): Promise<VideoServer[]> {
    if (!/^https?:\/\//.test(url)) return [];
    const kind = videoKind(url);
    return [
      {
        name: host(url).replace(/^www\./, "") || "Edson",
        url,
        kind,
        // plain http can't load on an https page, so it streams through storm
        referer: url.startsWith("http://") && kind !== "embed" ? `${SITE}/` : undefined,
      },
    ];
  },
});

export default defineExtension({
  pkg: "storm.studysto.edson",
  name: "Edson",
  version: "1.0.5",
  app: "studysto",
  sources: [edson],
});
