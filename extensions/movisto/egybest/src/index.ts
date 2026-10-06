// EgyBest (ايجي بست, egytbest.live) — Arabic-subtitled movies, series and
// anime. Every title page carries its players as buttons, and series and
// episode pages carry the season's episode row.

import {
  SourceError,
  chapterNumber,
  clean,
  defineExtension,
  defineFilmSource,
  seasonNumber,
  year,
  type Context,
  type Doc,
  type Episode,
  type FilmDetails,
  type FilmSummary,
  type Paged,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";

const DEFAULT_SITE = "https://egytbest.live";
const L = (en: string, ar: string): Text => ({ en, ar });

const site = (ctx: Context) => {
  const s = String(ctx.settings.address ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+$/i.test(s) ? s : DEFAULT_SITE;
};
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const idOf = (ctx: Context, href: string | null | undefined) => {
  if (!href) return undefined;
  try {
    const path = decode(new URL(href, site(ctx)).pathname).replace(/^\/+|\/+$/g, "");
    return path && !/^(movies|series|episodes|trending|page|category)$/.test(path) && !path.startsWith("page/") ? path : undefined;
  } catch {
    return undefined;
  }
};
const urlOf = (ctx: Context, id: string) => `${site(ctx)}/${id.split("/").map(encodeURIComponent).join("/")}/`;
const isSeries = (id: string) => id.startsWith("series/") || /الحلقة|الموسم/.test(id);
const tidy = (t: string) =>
  clean(t)
    .replace(/\s*-\s*ايجى\s*بست.*$/, "")
    .replace(/^(?:مشاهدة\s+)?(?:فيلم|مسلسل|انمي|برنامج)\s+/, "")
    .replace(/\s+(?:مترجم[ةه]?|مدبلج[ةه]?|كامل[ةه]?|اون\s*لاين)(?=\s|$)/g, "")
    .trim();
const fullSize = (src: string | null | undefined) => (src && !/src-default/.test(src) ? src.replace(/-\d+x\d+(\.\w+)$/, "$1") : undefined);

function cards(ctx: Context, doc: Doc): FilmSummary[] {
  return doc.all("a.block").flatMap((a): FilmSummary[] => {
    const id = idOf(ctx, a.href());
    const title = tidy(a.one("h3.title")?.text() ?? a.one("img")?.attr("alt") ?? "");
    if (!id || !title || id === "series/انمي") return [];
    return [{ id, title, cover: fullSize(a.one("img")?.href("data-src")), url: urlOf(ctx, id), kind: isSeries(id) ? "series" : "movie", year: year(title), quality: clean(a.one(".ribbon")?.text()) || undefined }];
  });
}

async function grid(ctx: Context, path: string, page: number): Promise<Paged<FilmSummary>> {
  const doc = await ctx.http.doc(`${site(ctx)}/${path}/${page > 1 ? `page/${page}/` : ""}`);
  const items = cards(ctx, doc);
  const next = doc.all("a[href]").some((a) => (a.attr("href") ?? "").includes(`/page/${page + 1}/`));
  return { items, hasNext: next && items.length > 0 };
}

// <li><label>القسم</label><div class="flex-1">افلام اسيوية</div></li>
function facts(doc: Doc) {
  const out = new Map<string, string>();
  for (const li of doc.all("li")) {
    const label = clean(li.one("label")?.text());
    const value = clean(li.one(".flex-1")?.text());
    if (label && value) out.set(label, value);
  }
  return out;
}

// The season's row of episodes, on a show page or any of its episode pages.
function episodeRow(ctx: Context, doc: Doc) {
  const article = doc.all("article.main-article").find((a) => /حلقات الموسم/.test(a.one("h2")?.text() ?? ""));
  return article ? cards(ctx, article as Doc) : [];
}

const egybest = defineFilmSource({
  id: "egybest",
  name: "EgyBest",
  lang: "ar",
  baseUrl: DEFAULT_SITE,
  rateLimit: { requests: 3, perMs: 1000 },
  settings: [
    {
      id: "address",
      type: "text",
      label: L("Address", "العنوان"),
      description: L("EgyBest moves to a new address now and then; put the new one here.", "ينتقل إيجي بست إلى عنوان جديد بين حين وآخر؛ ضع العنوان الجديد هنا."),
      default: DEFAULT_SITE,
    },
  ],
  listings: [
    { id: "movies", label: L("Movies", "أفلام") },
    { id: "episodes", label: L("New episodes", "أحدث الحلقات") },
    { id: "series", label: L("Series", "مسلسلات") },
    { id: "trending", label: L("Most watched", "الأكثر مشاهدة") },
  ],
  filters: [],

  list: (ctx, { listing, page }) => grid(ctx, listing === "episodes" ? "episodes" : listing === "series" ? "series" : listing === "trending" ? "trending" : "movies", page),

  async search(ctx, { query, page }) {
    const doc = await ctx.http.doc(`${site(ctx)}/${page > 1 ? `page/${page}/` : ""}`, { query: { s: query } });
    const items = cards(ctx, doc);
    return { items, hasNext: items.length > 0 && doc.all("a[href]").some((a) => (a.attr("href") ?? "").includes(`/page/${page + 1}/`)) };
  },

  async details(ctx, id): Promise<FilmDetails> {
    const doc = await ctx.http.doc(urlOf(ctx, id), { cacheMs: 10 * 60_000 });
    const raw = doc.one("meta[property='og:title']")?.attr("content") ?? "";
    if (!raw) throw new SourceError("not-found", `EgyBest has no title "${id}"`);
    const info = facts(doc);
    const series = isSeries(id);
    const title = tidy(raw).replace(/\s+الموسم\s+.+$/, "").replace(/\s+الحلقة\s+\d+.*$/, "");
    return {
      id,
      title,
      url: urlOf(ctx, id),
      cover: doc.one("meta[property='og:image']")?.attr("content") ?? undefined,
      kind: series ? "series" : "movie",
      year: year(raw) ?? year(info.get("تاريخ النشر")),
      quality: info.get("الجودة") || undefined,
      altTitles: [],
      description: clean(doc.one("p.description")?.text()).replace(/^القص[ةه]\s*/, "") || undefined,
      genres: [],
      cast: [],
      directors: [],
      countries: [],
      languages: [],
      // a show page, or an episode standing for its season: either carries the season's episodes
      seasons: series ? [{ id, number: seasonNumber(raw) ?? 1 }] : [],
    };
  },

  async episodes(ctx, _filmId, seasonId): Promise<Episode[]> {
    const doc = await ctx.http.doc(urlOf(ctx, seasonId), { cacheMs: 10 * 60_000 });
    const seen = new Set<string>();
    return episodeRow(ctx, doc).flatMap((e): Episode[] => {
      if (seen.has(e.id)) return [];
      seen.add(e.id);
      return [{ id: e.id, number: chapterNumber(e.title) ?? chapterNumber(e.id), title: e.title, url: e.url }];
    });
  },

  async servers(ctx, filmId, episodeId) {
    const doc = await ctx.http.doc(urlOf(ctx, episodeId ?? filmId));
    const seen = new Set<string>();
    const out = doc.all("#WatchServers [data-embed-url], [data-embed-url]").flatMap((b): VideoServer[] => {
      const url = b.href("data-embed-url");
      if (!url || seen.has(url)) return [];
      seen.add(url);
      return [{ name: clean(b.text()) || new URL(url).host, url, kind: /\.m3u8(\?|$)/.test(url) ? "hls" : "embed", audio: "sub", lang: "ar" }];
    });
    if (!out.length) {
      const frame = doc.one("iframe#mainPlayer")?.href("src");
      if (frame) out.push({ name: new URL(frame).host, url: frame, kind: "embed", audio: "sub", lang: "ar" });
    }
    return out;
  },
});

export default defineExtension({
  pkg: "storm.movisto.egybest",
  name: "EgyBest",
  version: "1.0.0",
  app: "movisto",
  sources: [egybest],
});
