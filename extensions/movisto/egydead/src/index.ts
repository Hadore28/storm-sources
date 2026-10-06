// EgyDead — Arabic-subtitled movies, series and anime on a WordPress site.
// Series come as season pages with their episodes; a title's players appear
// only after the page's "watch" form is sent, so servers are read from that answer.

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

const DEFAULT_SITE = "https://tv10.egydead.live";
const L = (en: string, ar: string): Text => ({ en, ar });

// The site's sections: [path, English, Arabic]
const SECTIONS: [string, string, string][] = [
  ["category/english-movies", "English movies", "أفلام أجنبي"],
  ["category/افلام-عربي", "Arabic movies", "أفلام عربي"],
  ["category/افلام-تركية", "Turkish movies", "أفلام تركية"],
  ["category/hindi-movies", "Indian movies", "أفلام هندية"],
  ["category/افلام-اسيوية", "Asian movies", "أفلام آسيوية"],
  ["category/افلام-كرتون", "Animated movies", "أفلام كرتون"],
  ["category/افلام-انمي", "Anime movies", "أفلام أنمي"],
  ["category/افلام-وثائقية", "Documentaries", "أفلام وثائقية"],
  ["category/english-movies/افلام-اجنبية-مدبلجة", "Dubbed movies", "أفلام مدبلجة"],
  ["series-category/english-series", "English series", "مسلسلات أجنبي"],
  ["series-category/arabic-series", "Arabic series", "مسلسلات عربي"],
  ["series-category/turkish-series", "Turkish series", "مسلسلات تركية"],
  ["series-category/asian-series", "Asian series", "مسلسلات آسيوية"],
  ["series-category/indian-series", "Indian series", "مسلسلات هندية"],
  ["series-category/latino-series", "Latin series", "مسلسلات لاتينية"],
  ["series-category/cartoon-series", "Cartoons", "مسلسلات كرتون"],
  ["series-category/anime-series", "Anime", "مسلسلات أنمي"],
  ["series-category/documentary-series", "Documentary series", "مسلسلات وثائقية"],
  ["series-category/tv-shows", "TV shows", "برامج تلفزيونية"],
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
// the path after the domain, e.g. "season/fbi-s09" or a film's own slug
const idOf = (ctx: Context, href: string | null | undefined) => {
  if (!href) return undefined;
  try {
    const u = new URL(href, site(ctx));
    const path = decode(u.pathname).replace(/^\/+|\/+$/g, "");
    return path && !/^(category|series-category|page|type|tag)\//.test(path) && path !== "h3" ? path : undefined;
  } catch {
    return undefined;
  }
};
const urlOf = (ctx: Context, id: string) => `${site(ctx)}/${id.split("/").map(encodeURIComponent).join("/")}/`;
const isSeries = (id: string) => /^(season|episode|serie)\//.test(id);
// "مشاهدة فيلم X 2014 مترجم" → "X 2014"
const tidy = (t: string) =>
  clean(t)
    .replace(/^(?:مشاهدة\s+)?(?:و\s*تحميل\s+)?(?:فيلم|مسلسل|برنامج|انمي|أنمي|عرض)\s+/, "")
    .replace(/\s+(?:مترجم[ةه]?|مدبلج[ةه]?|كامل[ةه]?|اون\s*لاين|HD)(?=\s|$)/g, "")
    .trim();
const fullSize = (src: string | null | undefined) => src?.replace(/-\d+x\d+(\.\w+)$/, "$1") || undefined;

function cards(ctx: Context, doc: Doc): FilmSummary[] {
  return doc.all("li.movieItem").flatMap((li): FilmSummary[] => {
    const a = li.one("a");
    const id = idOf(ctx, a?.href());
    const title = tidy(li.one(".BottomTitle")?.text() ?? a?.attr("title") ?? "");
    if (!id || !title) return [];
    return [{ id, title, cover: fullSize(li.one("img")?.href("src")), url: urlOf(ctx, id), kind: isSeries(id) ? "series" : "movie", year: year(title) }];
  });
}

async function grid(ctx: Context, path: string, page: number): Promise<Paged<FilmSummary>> {
  // the theme pages with "?page=N/"
  const doc = await ctx.http.doc(`${site(ctx)}/${path.split("/").map(encodeURIComponent).join("/")}/${page > 1 ? `?page=${page}/` : ""}`);
  const items = cards(ctx, doc);
  const next = doc.all("a[href]").some((a) => (a.attr("href") ?? "").includes(`page=${page + 1}/`));
  return { items, hasNext: next && items.length > 0 };
}

const section = (filters: FilterValues, fallback: string) => {
  const v = filters.section;
  return typeof v === "string" && SECTIONS.some(([p]) => p === v) ? v : fallback;
};

// The fact box: <li><span>اللغه : </span> value or links</li>
function facts(doc: Doc) {
  const out = new Map<string, { text: string; links: string[] }>();
  for (const li of doc.all(".LeftBox li")) {
    const label = clean(li.one("span")?.text()).replace(/\s*:\s*$/, "");
    if (!label) continue;
    const links = li.all("a").map((a) => clean(a.text())).filter(Boolean);
    out.set(label, { text: clean(li.text()).replace(/^[^:]*:\s*/, ""), links });
  }
  return out;
}

async function seasonsOf(ctx: Context, doc: Doc, self?: string): Promise<Season[]> {
  const list = doc.all(".seasons-list li.movieItem a").flatMap((a): Season[] => {
    const id = idOf(ctx, a.href());
    if (!id?.startsWith("season/")) return [];
    const title = tidy(a.attr("title") ?? a.text());
    return [{ id, number: seasonNumber(title) ?? seasonNumber(id), title }];
  });
  if (!list.length && self) list.push({ id: self, number: seasonNumber(tidy(doc.one("meta[property='og:title']")?.attr("content") ?? "")) ?? seasonNumber(self) });
  const seen = new Set<string>();
  return list
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
}

const egydead = defineFilmSource({
  id: "egydead",
  name: "EgyDead",
  lang: "ar",
  baseUrl: DEFAULT_SITE,
  rateLimit: { requests: 3, perMs: 1000 },
  settings: [
    {
      id: "address",
      type: "text",
      label: L("Address", "العنوان"),
      description: L("EgyDead moves to a new address now and then; put the new one here.", "ينتقل إيجي ديد إلى عنوان جديد بين حين وآخر؛ ضع العنوان الجديد هنا."),
      default: DEFAULT_SITE,
    },
  ],
  listings: [
    { id: "movies", label: L("English movies", "أفلام أجنبي") },
    { id: "series", label: L("English series", "مسلسلات أجنبي") },
    { id: "arabic", label: L("Arabic movies", "أفلام عربي") },
    { id: "browse", label: L("By section", "حسب القسم"), filters: true },
  ],
  filters: [{ id: "section", type: "select", label: L("Section", "القسم"), options: SECTIONS.map(([value, en, ar]) => ({ value, label: L(en, ar) })), default: SECTIONS[0][0] }],

  list(ctx, { listing, page, filters }) {
    const path = listing === "series" ? "series-category/english-series" : listing === "arabic" ? "category/افلام-عربي" : listing === "browse" ? section(filters, SECTIONS[0][0]) : "category/english-movies";
    return grid(ctx, path, page);
  },

  async search(ctx, { query, page }) {
    if (page > 1) return { items: [], hasNext: false };
    const doc = await ctx.http.doc(`${site(ctx)}/`, { query: { s: query } });
    return { items: cards(ctx, doc), hasNext: false };
  },

  async details(ctx, id): Promise<FilmDetails> {
    const doc = await ctx.http.doc(urlOf(ctx, id), { cacheMs: 10 * 60_000 });
    const rawTitle = doc.one("meta[property='og:title']")?.attr("content") ?? doc.one(".singleTitle em")?.text() ?? "";
    if (!rawTitle || /^ايجي ديد$/.test(clean(rawTitle))) throw new SourceError("not-found", `EgyDead has no title "${id}"`);
    const info = facts(doc);
    const field = (word: string) => [...info.entries()].find(([k]) => k.includes(word))?.[1];
    let seasons: Season[] = [];
    if (id.startsWith("episode/")) {
      // an episode card stands for its season
      const seasonLink = doc.all("a[href*='/season/']").map((a) => idOf(ctx, a.href())).find((s) => s && s !== "season");
      if (seasonLink) seasons = await seasonsOf(ctx, await ctx.http.doc(urlOf(ctx, seasonLink), { cacheMs: 10 * 60_000 }), seasonLink);
    } else if (isSeries(id)) {
      seasons = await seasonsOf(ctx, doc, id.startsWith("season/") ? id : undefined);
    }
    const title = tidy(rawTitle).replace(/\s+الحلقة\s+\d+.*$/, "").replace(/^جميع مواسم\s+(?:مسلسل\s+)?/, "");
    return {
      id,
      title,
      url: urlOf(ctx, id),
      cover: doc.one("meta[property='og:image']")?.attr("content") ?? undefined,
      kind: isSeries(id) ? "series" : "movie",
      year: year(field("السنه")?.text) ?? year(title),
      altTitles: [],
      description: clean(doc.one(".extra-content p")?.text()) || clean(doc.one(".singleStory")?.text()) || undefined,
      genres: (field("النوع")?.links ?? []).map((name) => ({ name, key: genreKey(name) })),
      duration: minutes(field("مده")?.text),
      cast: field("الممثلين")?.links ?? field("بطولة")?.links ?? [],
      directors: field("اخراج")?.links ?? field("المخرج")?.links ?? [],
      countries: field("البلد")?.text ? [field("البلد")!.text] : [],
      languages: field("اللغه")?.text ? [field("اللغه")!.text] : [],
      quality: field("الجوده")?.text || undefined,
      seasons,
    };
  },

  async episodes(ctx, _filmId, seasonId): Promise<Episode[]> {
    const doc = await ctx.http.doc(urlOf(ctx, seasonId), { cacheMs: 10 * 60_000 });
    const seen = new Set<string>();
    return doc.all(".EpsList a").flatMap((a): Episode[] => {
      const id = idOf(ctx, a.href());
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const text = clean(a.text());
      return [{ id, number: chapterNumber(text) ?? chapterNumber(id.replace(/^.*e(\d+)$/i, "$1")), title: clean(a.attr("title")) || undefined, url: urlOf(ctx, id) }];
    });
  },

  async servers(ctx, filmId, episodeId) {
    const url = urlOf(ctx, episodeId ?? filmId);
    // the players are only in the answer to the page's "watch" form
    const doc = ctx.html(await ctx.http.text(url, { method: "POST", form: { View: "1" }, headers: { Referer: url } }), url);
    const out: VideoServer[] = doc.all(".serversList li[data-link]").flatMap((li): VideoServer[] => {
      const link = li.href("data-link");
      return link ? [{ name: clean(li.one("p")?.text()) || new URL(link).host, url: link, kind: /\.m3u8(\?|$)/.test(link) ? "hls" : "embed", audio: "sub", lang: "ar" }] : [];
    });
    for (const li of doc.all(".donwload-servers-list li")) {
      const link = li.one("a.ser-link")?.href();
      if (!link) continue;
      out.push({ name: clean(li.one(".ser-name")?.text()) || new URL(link).host, url: link, kind: "embed", quality: clean(li.one(".server-info em")?.text()) || undefined, download: true });
    }
    return out;
  },
});

export default defineExtension({
  pkg: "storm.movisto.egydead",
  name: "EgyDead",
  version: "1.0.0",
  app: "movisto",
  sources: [egydead],
});
