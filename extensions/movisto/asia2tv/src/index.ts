// Asia2TV — Asian dramas and films with Arabic subtitles. Adapted from yuzono's
// Aniyomi extension (Apache-2.0); a drama is one season, its episodes on its page.

import {
  SourceError,
  clean,
  defineExtension,
  defineFilmSource,
  type Context,
  type Doc,
  type FilmSummary,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";
import { withDirect } from "../../../players";

const SITE = "https://ww1.asia2tv.pw";
const L = (en: string, ar: string): Text => ({ en, ar });

const LISTS: { id: string; path: string; label: Text }[] = [
  { id: "dramas", path: "category/asian-drama", label: L("Asian dramas", "الدراما الآسيوية") },
  { id: "korean", path: "category/asian-drama/korean", label: L("Korean", "كورية") },
  { id: "chinese", path: "category/asian-drama/chinese-taiwanese", label: L("Chinese", "صينية") },
  { id: "japanese", path: "category/asian-drama/japanese", label: L("Japanese", "يابانية") },
  { id: "thai", path: "category/asian-drama/thai", label: L("Thai", "تايلاندية") },
  { id: "movies", path: "category/asian-movies", label: L("Asian films", "أفلام آسيوية") },
];

const idOf = (href: string | null) => {
  try {
    return href ? decodeURIComponent(new URL(href).pathname.split("/").filter(Boolean).join("~")) || undefined : undefined;
  } catch {
    return undefined;
  }
};
const urlOf = (id: string) => `${SITE}/${id.split("~").map(encodeURIComponent).join("/")}/`;

const cards = (doc: Doc): FilmSummary[] =>
  doc.all("div.postmovie-photo a[title]").flatMap((a): FilmSummary[] => {
    const id = idOf(a.href());
    if (!id) return [];
    const img = a.one("img");
    return [{ id, title: clean(a.attr("title")), cover: img?.href("data-src") ?? img?.href() ?? undefined, url: urlOf(id), kind: /فيلم/.test(a.attr("title") ?? "") ? "movie" : "series" }];
  });

const page = async (ctx: Context, url: string) => {
  const doc = await ctx.http.doc(url);
  return { items: cards(doc), hasNext: !!doc.one("div.nav-links a.next") };
};

const asia2tv = defineFilmSource({
  id: "asia2tv",
  name: "Asia2TV",
  lang: "ar",
  baseUrl: SITE,
  rateLimit: { requests: 3, perMs: 1000 },
  listings: LISTS.map(({ id, label }) => ({ id, label })),
  filters: [],

  list: (ctx, { listing, page: n }) => page(ctx, `${SITE}/${(LISTS.find((l) => l.id === listing) ?? LISTS[0]).path}/${n > 1 ? `page/${n}/` : ""}`),
  search: (ctx, { query, page: n }) => page(ctx, `${SITE}/${n > 1 ? `page/${n}/` : ""}?s=${encodeURIComponent(query)}`),

  async details(ctx, id) {
    const doc = await ctx.http.doc(urlOf(id), { cacheMs: 5 * 60_000 });
    const info = doc.one(".info-detail-single");
    const title = clean(info?.one("h1, h2")?.text()) || clean(doc.one("h1")?.text());
    if (!title) throw new SourceError("not-found", `Asia2TV has no page "${id}"`);
    const text = clean(info?.text());
    const LABELS = "الاسم بالعربي|يعرف ايضا بـ|عدد الحلقات|البلد المنتج|موعد البث|النوع|المشاركين بالعمل";
    const field = (label: string) => new RegExp(`${label}\\s*:\\s*(.+?)\\s*(?=(?:${LABELS})\\s*:|المشاركين|$)`).exec(text)?.[1]?.trim();
    const genres = info?.all('a[href*="/genre/"], a[href*="/category/"]').map((a) => clean(a.text())).filter(Boolean) ?? [];
    const episodes = doc.all("div.loop-episode a").length;
    return {
      id,
      title,
      url: urlOf(id),
      kind: episodes ? "series" : "movie",
      cover: doc.one(".single-thumb-bg img")?.href("data-src") ?? doc.one(".single-thumb-bg img")?.href() ?? undefined,
      year: Number(/\b(19|20)\d{2}\b/.exec(field("موعد البث") ?? "")?.[0]) || undefined,
      altTitles: [field("الاسم بالعربي"), field("يعرف ايضا بـ")].filter((t): t is string => !!t && t !== title),
      description: clean(info?.one("p")?.text()) || undefined,
      genres: genres.map((name) => ({ name })),
      cast: info?.all('a[href*="/actor"], a[href*="/cast"]').map((a) => clean(a.text())) ?? [],
      directors: [],
      countries: [field("البلد المنتج")].filter((c): c is string => !!c),
      languages: [],
      seasons: episodes ? [{ id, number: 1 }] : [],
    };
  },

  async episodes(ctx, _filmId, seasonId) {
    const doc = await ctx.http.doc(urlOf(seasonId), { cacheMs: 5 * 60_000 });
    const seen = new Set<string>();
    return doc
      .all("div.loop-episode a")
      .flatMap((a) => {
        const id = idOf(a.href());
        if (!id || seen.has(id)) return [];
        seen.add(id);
        return [{ id, number: Number(/(\d+)\D*$/.exec(id)?.[1]) || undefined, title: clean(a.one(".titlepisode")?.text()) || undefined }];
      })
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
  },

  async servers(ctx, filmId, episodeId) {
    const doc = await ctx.http.doc(urlOf(episodeId ?? filmId));
    const out: VideoServer[] = doc.all("ul.server-list-menu li[data-server], li.serverslist[data-server]").flatMap((li): VideoServer[] => {
      const url = li.attr("data-server")?.replace(/^\/\//, "https://");
      return url && /^https?:\/\//.test(url) ? [{ name: clean(li.text()) || "Server", url, kind: "embed", lang: "ar", audio: "sub" }] : [];
    });
    if (!out.length) throw new SourceError("not-found", `Asia2TV has no servers for ${episodeId ?? filmId}`);
    return withDirect(ctx, out, `${SITE}/`);
  },
});

export default defineExtension({
  pkg: "storm.movisto.asia2tv",
  name: "Asia2TV",
  version: "1.0.2",
  app: "movisto",
  sources: [asia2tv],
});
