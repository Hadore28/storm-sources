// TopCinema (توب سينما) — Arabic-subtitled movies and series on a WordPress
// theme. A show page lists its seasons, a season page its episodes; each
// title's watch page names its servers, and each server's player comes from
// the theme's server endpoint.

import {
  SourceError,
  chapterNumber,
  clean,
  defineExtension,
  defineFilmSource,
  genreKey,
  minutes,
  seasonNumber,
  year,
  type Context,
  type Doc,
  type Episode,
  type FilmDetails,
  type FilmSummary,
  type FilterValues,
  type Paged,
  type Season,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";

const DEFAULT_SITE = "https://web.topcinema.io";
const L = (en: string, ar: string): Text => ({ en, ar });

// [path, English, Arabic]
const SECTIONS: [string, string, string][] = [
  ["movies", "All movies", "كل الأفلام"],
  ["category/افلام-اجنبي-8", "English movies", "أفلام أجنبي"],
  ["category/افلام-اسيوي", "Asian movies", "أفلام آسيوية"],
  ["category/افلام-انمي-2", "Anime movies", "أفلام أنمي"],
  ["netflix-movies", "Netflix movies", "أفلام نتفليكس"],
  ["top-rating-imdb", "Top rated movies", "الأعلى تقييماً"],
  ["category/مسلسلات-اجنبي", "English series", "مسلسلات أجنبي"],
  ["category/مسلسلات-اسيوية", "Asian series", "مسلسلات آسيوية"],
  ["category/مسلسلات-انمي", "Anime series", "مسلسلات أنمي"],
  ["top-rating-imdb-series", "Top rated series", "مسلسلات الأعلى تقييماً"],
];

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
    const u = new URL(href, site(ctx));
    const path = decode(u.pathname).replace(/^\/+|\/+$/g, "").replace(/\/(?:watch|download|list)$/, "");
    return path && !/^(category|page|tag|movies|recent)(?:\/|$)/.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
};
const urlOf = (ctx: Context, id: string) => `${site(ctx)}/${id.split("/").map(encodeURIComponent).join("/")}/`;
const isEpisode = (id: string) => /الحلقة/.test(id) && !id.startsWith("series/");
const isSeries = (id: string) => id.startsWith("series/") || isEpisode(id);
const tidy = (t: string) =>
  clean(t)
    .replace(/\s*-\s*توب\s*سينما\s*$/, "")
    .replace(/^(?:مشاهدة\s+)?(?:فيلم|مسلسل|انمي|أنمي|برنامج)\s+/, "")
    .replace(/\s+(?:مترجم[ةه]?|مدبلج[ةه]?|اون\s*لاين|كامل[ةه]?)(?=\s|$)/g, "")
    .trim();

function cards(ctx: Context, doc: Doc): FilmSummary[] {
  return doc.all(".Small--Box").flatMap((box): FilmSummary[] => {
    const a = box.one("a");
    const id = idOf(ctx, a?.href());
    const img = box.one("img");
    const title = tidy(box.one(".title")?.text() ?? a?.attr("title") ?? img?.attr("alt") ?? "");
    if (!id || !title) return [];
    const cover = img?.href("data-src") ?? undefined;
    return [
      {
        id,
        title,
        cover: cover && !/\/cover\.jpg$/.test(cover) ? cover.replace(/-\d+x\d+(\.\w+)$/, "$1") : undefined,
        url: urlOf(ctx, id),
        kind: isSeries(id) ? "series" : "movie",
        year: year(title),
        quality: clean(box.one(".ribbon")?.text()) || undefined,
      },
    ];
  });
}

async function grid(ctx: Context, path: string, page: number, query?: Record<string, string>): Promise<Paged<FilmSummary>> {
  const doc = await ctx.http.doc(`${site(ctx)}/${path.split("/").map(encodeURIComponent).join("/")}/${page > 1 ? `page/${page}/` : ""}`, { query });
  const items = cards(ctx, doc);
  const next = doc.all("a[href]").some((a) => (a.attr("href") ?? "").includes(`/page/${page + 1}/`));
  return { items, hasNext: next && items.length > 0 };
}

const section = (filters: FilterValues) => {
  const v = filters.section;
  return typeof v === "string" && SECTIONS.some(([p]) => p === v) ? v : SECTIONS[0][0];
};

function facts(doc: Doc) {
  const out = new Map<string, { text: string; links: string[] }>();
  for (const li of doc.all(".RightTaxContent li")) {
    const [k, ...v] = clean(li.text()).split(":");
    if (!v.length) continue;
    out.set(clean(k), { text: clean(v.join(":")), links: li.all("a").map((a) => clean(a.text())).filter(Boolean) });
  }
  return out;
}

async function seasonsOf(ctx: Context, doc: Doc): Promise<Season[]> {
  const seen = new Set<string>();
  return doc
    .all(".allseasonss .Small--Box.Season a")
    .flatMap((a): Season[] => {
      const id = idOf(ctx, a.href());
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const title = tidy(a.one(".title")?.text() ?? "");
      return [{ id, number: chapterNumber(a.one(".epnum")?.text()) ?? seasonNumber(title), title }];
    })
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
}

const topcinema = defineFilmSource({
  id: "topcinema",
  name: "TopCinema",
  lang: "ar",
  baseUrl: DEFAULT_SITE,
  rateLimit: { requests: 4, perMs: 1000 },
  settings: [
    {
      id: "address",
      type: "text",
      label: L("Address", "العنوان"),
      description: L("TopCinema moves to a new address now and then; put the new one here.", "ينتقل توب سينما إلى عنوان جديد بين حين وآخر؛ ضع العنوان الجديد هنا."),
      default: DEFAULT_SITE,
    },
  ],
  listings: [
    { id: "movies", label: L("Movies", "أفلام") },
    { id: "episodes", label: L("New episodes", "أحدث الحلقات") },
    { id: "series", label: L("Series", "مسلسلات") },
    { id: "browse", label: L("By section", "حسب القسم"), filters: true },
  ],
  filters: [{ id: "section", type: "select", label: L("Section", "القسم"), options: SECTIONS.map(([value, en, ar]) => ({ value, label: L(en, ar) })), default: SECTIONS[0][0] }],

  list(ctx, { listing, page, filters }) {
    if (listing === "episodes") return grid(ctx, "category/مسلسلات-اجنبي", page, { key: "episodes" });
    if (listing === "series") return grid(ctx, "category/مسلسلات-اجنبي", page);
    if (listing === "browse") return grid(ctx, section(filters), page);
    return grid(ctx, "movies", page);
  },

  async search(ctx, { query, page }) {
    const doc = await ctx.http.doc(`${site(ctx)}/${page > 1 ? `page/${page}/` : ""}`, { query: { s: query } });
    const items = cards(ctx, doc);
    return { items, hasNext: items.length > 0 && doc.all("a[href]").some((a) => (a.attr("href") ?? "").includes(`/page/${page + 1}/`)) };
  },

  async details(ctx, id): Promise<FilmDetails> {
    const doc = await ctx.http.doc(urlOf(ctx, id), { cacheMs: 10 * 60_000 });
    const raw = doc.one("meta[property='og:title']")?.attr("content") ?? "";
    if (!raw) throw new SourceError("not-found", `TopCinema has no title "${id}"`);
    const info = facts(doc);
    const field = (word: string) => [...info.entries()].find(([k]) => k.includes(word))?.[1];
    let seasons: Season[] = [];
    if (isEpisode(id)) {
      // an episode stands for its season: the breadcrumbs lead to the season page
      const seasonId = doc.all("a[href*='/series/']").map((a) => idOf(ctx, a.href())).filter((s): s is string => !!s && /الموسم/.test(s)).at(-1);
      if (seasonId) seasons = await seasonsOf(ctx, await ctx.http.doc(urlOf(ctx, seasonId), { cacheMs: 10 * 60_000 }));
    } else if (id.startsWith("series/")) {
      seasons = await seasonsOf(ctx, doc);
      // a show without season boxes is a single season: this page
      if (!seasons.length) seasons = [{ id, number: seasonNumber(raw) ?? 1 }];
    }
    const title = tidy(raw).replace(/\s+الموسم\s+.+$/, "").replace(/\s+الحلقة\s+\d+.*$/, "");
    const genres = field("نوع")?.links.length ? field("نوع")!.links : (field("نوع")?.text.split(/\s+/) ?? []);
    return {
      id,
      title,
      url: urlOf(ctx, id),
      // show pages have no og:image; their poster is the first uploaded image
      cover: doc.one("meta[property='og:image']")?.attr("content") ?? doc.all("img").map((i) => i.href("src")).find((s) => s?.includes("/wp-content/uploads/")) ?? undefined,
      kind: isSeries(id) ? "series" : "movie",
      year: year(field("موعد")?.text) ?? year(raw),
      quality: field("جودة")?.text || undefined,
      altTitles: [],
      description: clean(doc.one(".story p")?.text() ?? doc.one(".story")?.text()) || undefined,
      genres: genres.filter(Boolean).map((name) => ({ name, key: genreKey(name) })),
      duration: minutes(field("توقيت")?.text),
      cast: [],
      directors: [],
      countries: field("دولة")?.text ? [field("دولة")!.text] : [],
      languages: field("لغة")?.text ? [field("لغة")!.text] : [],
      seasons,
    };
  },

  async episodes(ctx, _filmId, seasonId): Promise<Episode[]> {
    const doc = await ctx.http.doc(urlOf(ctx, seasonId), { cacheMs: 10 * 60_000 });
    const seen = new Set<string>();
    return doc.all(".allepcont a").flatMap((a): Episode[] => {
      const id = idOf(ctx, a.href());
      if (!id || seen.has(id)) return [];
      seen.add(id);
      return [{ id, number: chapterNumber(a.one(".epnum")?.text()) ?? chapterNumber(id), title: tidy(a.one("h2")?.text() ?? "") || undefined, url: urlOf(ctx, id) }];
    });
  },

  async servers(ctx, filmId, episodeId) {
    const page = urlOf(ctx, episodeId ?? filmId);
    const watch = `${page}watch/`;
    const html = await ctx.http.text(watch);
    const doc = ctx.html(html, watch);
    const postId = /data-id="(\d+)"/.exec(html)?.[1];
    const slots = doc.all("[data-server]").map((el) => ({ i: el.attr("data-server") ?? "", name: clean(el.text()) })).filter((s) => /^\d+$/.test(s.i));
    const out: VideoServer[] = [];
    if (postId && slots.length) {
      const found = await Promise.all(
        slots.slice(0, 12).map(async ({ i, name }) => {
          try {
            const answer = await ctx.http.text(`${site(ctx)}/wp-content/themes/movies2023/Ajaxat/Single/Server.php`, {
              method: "POST",
              form: { id: postId, i },
              headers: { "X-Requested-With": "XMLHttpRequest", Referer: watch },
            });
            const src = /src=["']([^"']+)["']/.exec(answer)?.[1]?.trim();
            const url = src?.startsWith("//") ? `https:${src}` : src;
            return url && /^https?:\/\//.test(url) ? ({ name: name || new URL(url).host, url, kind: /\.m3u8(\?|$)/.test(url) ? "hls" : "embed", audio: "sub", lang: "ar" } as VideoServer) : null;
          } catch {
            return null;
          }
        }),
      );
      out.push(...found.filter((s): s is VideoServer => !!s));
    }
    if (!out.length) {
      const frame = doc.one("iframe")?.href("src");
      if (frame) out.push({ name: new URL(frame).host, url: frame, kind: "embed", audio: "sub", lang: "ar" });
    }
    try {
      const dl = await ctx.http.doc(`${page}download/`);
      for (const a of dl.all("a.downloadsLink")) {
        const url = a.href();
        if (!url) continue;
        // the button reads "VideoTube 1080p - 720p"
        const text = clean(a.text());
        out.push({ name: text.replace(/\s*\d{3,4}p[\s\S]*$/, "").trim() || new URL(url).host.replace(/^www\./, ""), url, kind: "embed", quality: /\d{3,4}p/.exec(text)?.[0], download: true });
      }
    } catch {
      // downloads are optional
    }
    return out;
  },
});

export default defineExtension({
  pkg: "storm.movisto.topcinema",
  name: "TopCinema",
  version: "1.0.0",
  app: "movisto",
  sources: [topcinema],
});
