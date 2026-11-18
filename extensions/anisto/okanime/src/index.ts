// OkAnime — an Arabic anime site. Adapted from yuzono's Aniyomi extension (Apache-2.0)
// to the site's current pages: servers are the links its player switches between.

import {
  SourceError,
  chapterNumber,
  clean,
  defineAnimeSource,
  defineExtension,
  genreKey,
  status,
  type AnimeSummary,
  type Context,
  type Doc,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";
import { withDirect } from "../../../players";

const SITE = "https://ww3.okanime.xyz";
const L = (en: string, ar: string): Text => ({ en, ar });
const QUALITY: Record<string, string> = { FHD: "1080p", HD: "720p", SD: "480p" };

const slug = (href: string | null, kind: "anime" | "episode") => href?.match(new RegExp(`/${kind}/([^/?#]+)`))?.[1];

const cards = (doc: Doc): AnimeSummary[] =>
  doc.all(".anime-card").flatMap((card): AnimeSummary[] => {
    const a = card.one(".anime-title h4 a") ?? card.one("a.clickable");
    const id = slug(a?.href() ?? null, "anime");
    if (!id) return [];
    return [{ id, title: clean(a!.text()) || clean(card.one("img")?.attr("alt")?.split("|")[0]), cover: card.one("img")?.href() ?? undefined, url: `${SITE}/anime/${id}` }];
  });

const page = async (ctx: Context, path: string) => {
  const doc = await ctx.http.doc(`${SITE}${path}`);
  const items = cards(doc);
  return { items, hasNext: !!doc.one('a[rel="next"], .pagination li:last-child:not(.disabled) a') && items.length > 0 };
};

const okanime = defineAnimeSource({
  id: "okanime",
  name: "OkAnime",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 3, perMs: 1000 },
  listings: [
    { id: "latest", label: L("Latest", "الأحدث") },
    { id: "all", label: L("All anime", "كل الأنميات") },
  ],
  filters: [],

  list: (ctx, { listing, page: n }) => (listing === "all" ? page(ctx, `/anime-list?page=${n}`) : n > 1 ? Promise.resolve({ items: [], hasNext: false }) : page(ctx, "/")),
  search: (ctx, { query, page: n }) => page(ctx, `/search?q=${encodeURIComponent(query)}${n > 1 ? `&page=${n}` : ""}`),

  async details(ctx, id) {
    const doc = await ctx.http.doc(`${SITE}/anime/${encodeURIComponent(id)}`, { cacheMs: 5 * 60_000 });
    const title = clean(doc.one(".animepage-title-block h1, h1.animepage-h1, .animepage-h1")?.text());
    if (!title) throw new SourceError("not-found", `OkAnime has no anime "${id}"`);
    const meta = Object.fromEntries(doc.all(".animepage-meta-row").map((r) => [clean(r.one("dt")?.text()), clean(r.one("dd")?.text())]));
    const genres = doc.all(".animepage-genres a").map((a) => clean(a.text())).filter(Boolean);
    return {
      id,
      title,
      url: `${SITE}/anime/${id}`,
      cover: doc.one("img.animepage-poster")?.href() ?? undefined,
      status: /يعرض/.test(meta["الحالة"] ?? "") ? "ongoing" : status(meta["الحالة"]),
      year: Number(meta["سنة العرض"]) || undefined,
      episodeCount: Number(meta["عدد الحلقات"]) || undefined,
      season: meta["الموسم"] || undefined,
      altTitles: [],
      description: clean(doc.one(".synopsis-text")?.text()) || undefined,
      genres: genres.map((name) => ({ name, key: genreKey(name) })),
      studios: [],
    };
  },

  async episodes(ctx, id) {
    const doc = await ctx.http.doc(`${SITE}/anime/${encodeURIComponent(id)}`, { cacheMs: 5 * 60_000 });
    const seen = new Set<string>();
    return doc
      .all('a.ep-compact-btn, .episode-card a[href*="/episode/"]')
      .flatMap((a) => {
        const ep = slug(a.href(), "episode");
        if (!ep || seen.has(ep)) return [];
        seen.add(ep);
        return [{ id: ep, number: chapterNumber(a.attr("title") ?? a.text()) ?? chapterNumber(ep.split("-episode-").pop()) }];
      })
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  },

  async servers(ctx, _animeId, episodeId) {
    const doc = await ctx.http.doc(`${SITE}/episode/${encodeURIComponent(episodeId)}`);
    const out: VideoServer[] = [];
    const seen = new Set<string>();
    for (const a of doc.all("a.ep-link")) {
      // the link sits in a script string, so "&" comes as &
      const url = /setServer\('([^']+)'\)/.exec(a.attr("@click") ?? "")?.[1]?.replace(/\\u([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
      if (!url || seen.has(url) || !/^https?:\/\//.test(url)) continue;
      seen.add(url);
      const label = clean(a.one("span")?.text());
      const name = clean(a.text()).replace(label, "").trim() || a.attr("data-server") || "Server";
      out.push({ name, url, kind: "embed", quality: a.attr("data-umami-event-quality") ?? QUALITY[label], audio: "sub", lang: "ar" });
    }
    if (!out.length) throw new SourceError("not-found", `OkAnime has no servers for ${episodeId}`);
    return withDirect(ctx, out, `${SITE}/`);
  },
});

export default defineExtension({
  pkg: "storm.anisto.okanime",
  name: "OkAnime",
  version: "1.0.1",
  app: "anisto",
  sources: [okanime],
});
