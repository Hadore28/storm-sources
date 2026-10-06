// Akwam (اكوام) — Arabic-subtitled movies and series. Plain server-rendered
// pages; each title's watch pages carry its video as MP4 files that allow
// playback from other sites, so they play in storm's own player.

import {
  SourceError,
  chapterNumber,
  clean,
  defineExtension,
  defineFilmSource,
  genreKey,
  minutes,
  year,
  type Context,
  type Doc,
  type Episode,
  type FilmDetails,
  type FilmSummary,
  type FilterDef,
  type FilterValues,
  type Paged,
  type Text,
  type VideoServer,
} from "@storm-sources/sdk";

const DEFAULT_SITE = "https://akwam.ss";
const L = (en: string, ar: string): Text => ({ en, ar });
const FILTERS: { id: string; label: Text }[] = [
  { id: "section", label: L("Section", "القسم") },
  { id: "category", label: L("Genre", "التصنيف") },
  { id: "year", label: L("Year", "سنة الإنتاج") },
  { id: "language", label: L("Language", "اللغة") },
  { id: "quality", label: L("Resolution", "الدقة") },
  { id: "rating", label: L("Rating", "التقييم") },
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
// "movie/11497/onslaught", "series/5795/a-tale-of-two-cities", "episode/103221/…"
const pathOf = (href: string | null | undefined, kinds = "movie|series|episode") => {
  const m = href?.match(new RegExp(`/((?:${kinds})/\\d+/[^?#]+?)/?(?:[?#]|$)`))?.[1];
  return m ? decode(m) : undefined;
};
const urlOf = (ctx: Context, path: string) => `${site(ctx)}/${path.split("/").map(encodeURIComponent).join("/")}`;
// thumbnails sit under /thumb/<size>/; the original is the same path without it
const fullImage = (src: string | null | undefined) => src?.replace(/\/thumb\/\d+x\d+\//, "/") || undefined;

function cards(ctx: Context, doc: Doc): FilmSummary[] {
  return doc.all(".entry-box").flatMap((box): FilmSummary[] => {
    const a = box.one("a.box");
    const id = pathOf(a?.href(), "movie|series");
    const img = box.one("img");
    const title = clean(img?.attr("alt") ?? box.one(".entry-title")?.text());
    if (!id || !title) return [];
    const score = Number(clean(box.one(".label.rating")?.text()));
    return [
      {
        id,
        title,
        cover: img?.href("data-src") ?? img?.href("src") ?? undefined,
        url: urlOf(ctx, id),
        kind: id.startsWith("series/") ? "series" : "movie",
        year: year(title),
        score: score > 0 && score <= 10 ? score : undefined,
        quality: clean(box.one(".label.quality")?.text()) || undefined,
      },
    ];
  });
}

async function grid(ctx: Context, path: string, page: number, query: Record<string, string | undefined>): Promise<Paged<FilmSummary>> {
  const doc = await ctx.http.doc(`${site(ctx)}${path}`, { query: { ...query, page: page > 1 ? page : undefined } });
  const items = cards(ctx, doc);
  const next = doc.all("a[href]").some((a) => (a.attr("href") ?? "").includes(`page=${page + 1}`));
  return { items, hasNext: next && items.length > 0 };
}

const chosen = (filters: FilterValues) =>
  Object.fromEntries(FILTERS.map((f) => [f.id, typeof filters[f.id] === "string" && filters[f.id] !== "0" ? String(filters[f.id]) : undefined]));

// "اللغة : الإنجليزية" lines in the title's fact box
function facts(doc: Doc) {
  const out = new Map<string, string>();
  for (const el of doc.all(".font-size-16.text-white span")) {
    const [k, ...v] = clean(el.text()).split(":");
    if (v.length) out.set(clean(k), clean(v.join(":")));
  }
  return out;
}

async function watchFiles(ctx: Context, page: Doc): Promise<VideoServer[]> {
  const watches = [...new Set(page.all("a[href*='/watch/']").map((a) => a.href()).filter((u): u is string => !!u))].slice(0, 4);
  const found = await Promise.all(
    watches.map(async (url) => {
      try {
        // Akwam holds every watch page for about a minute before answering
        const doc = await ctx.http.doc(url, { timeoutMs: 80_000, retries: 0 });
        return doc.all("source").flatMap((s): VideoServer[] => {
          const src = s.href("src");
          const size = s.attr("size");
          return src && /^https?:\/\//.test(src) ? [{ name: "Akwam", url: src, kind: /\.m3u8(\?|$)/.test(src) ? "hls" : "mp4", quality: size ? `${size}p` : undefined, audio: "sub", lang: "ar" }] : [];
        });
      } catch {
        // one quality's page timing out shouldn't hide the others
        return [];
      }
    }),
  );
  return found.flat().sort((a, b) => (parseInt(b.quality ?? "0", 10) || 0) - (parseInt(a.quality ?? "0", 10) || 0));
}

const akwam = defineFilmSource({
  id: "akwam",
  name: "Akwam",
  lang: "ar",
  baseUrl: DEFAULT_SITE,
  rateLimit: { requests: 3, perMs: 1000 },
  // the video links carry an expiry
  cache: { servers: 30 * 60_000 },
  settings: [
    {
      id: "address",
      type: "text",
      label: L("Address", "العنوان"),
      description: L("Akwam moves to a new address now and then; put the new one here.", "ينتقل أكوام إلى عنوان جديد بين حين وآخر؛ ضع العنوان الجديد هنا."),
      default: DEFAULT_SITE,
    },
  ],
  listings: [
    { id: "movies", label: L("Movies", "أفلام"), filters: true },
    { id: "series", label: L("Series", "مسلسلات"), filters: true },
  ],
  // The site's own filter lists, read from its movies page.
  async filters(ctx): Promise<FilterDef[]> {
    const doc = await ctx.http.doc(`${site(ctx)}/movies`);
    return FILTERS.flatMap(({ id, label }): FilterDef[] => {
      const options = doc
        .all(`select[name='${id}'] option`)
        .map((o) => ({ value: o.attr("value") ?? "", name: clean(o.text()) }))
        .filter((o) => o.value && o.value !== "0" && o.name)
        .map((o) => ({ value: o.value, label: o.name, genre: id === "category" ? genreKey(o.name) : undefined }));
      return options.length ? [{ id, type: "select", label, options }] : [];
    });
  },
  searchFilters: true,

  list: (ctx, { listing, page, filters }) => grid(ctx, listing === "series" ? "/series" : "/movies", page, chosen(filters)),
  search: (ctx, { query, page, filters }) => grid(ctx, "/search", page, { q: query, ...chosen(filters) }),

  async details(ctx, id): Promise<FilmDetails> {
    const doc = await ctx.http.doc(urlOf(ctx, id), { cacheMs: 10 * 60_000 });
    const title = clean(doc.one("h1.entry-title")?.text());
    if (!title) throw new SourceError("not-found", `Akwam has no title "${id}"`);
    const info = facts(doc);
    const field = (word: string) => [...info.entries()].find(([k]) => k.includes(word))?.[1] ?? "";
    const poster = doc.one("a[data-fancybox] img");
    const score = Number(clean(doc.one(".font-size-16.text-white.d-flex span")?.text()).split("/")[1]);
    const imdb = doc.one("a[href*='imdb.com/title/']")?.href()?.match(/tt\d+/)?.[0];
    const isSeries = id.startsWith("series/");
    const season = chapterNumber(title.match(/(?:season|الموسم)\s*\S+/i)?.[0]) ?? 1;
    const storyBox = doc.all(".widget").find((w) => /قصة/.test(w.one(".header-title")?.text() ?? ""));
    return {
      id,
      title,
      url: urlOf(ctx, id),
      cover: fullImage(poster?.href("src")) ?? doc.one("meta[property='og:image']")?.attr("content") ?? undefined,
      backdrop: doc.one("meta[property='og:image']")?.attr("content") ?? undefined,
      kind: isSeries ? "series" : "movie",
      year: year(field("السنة")) ?? year(title),
      score: score > 0 && score <= 10 ? score : undefined,
      quality: field("جودة") || undefined,
      altTitles: [],
      description: clean(storyBox?.one(".widget-body")?.text()).replace(new RegExp(`^(?:فيلم|مسلسل)\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "") || undefined,
      genres: doc.all(".font-size-16 a.badge").map((a) => clean(a.text())).filter(Boolean).map((name) => ({ name, key: genreKey(name) })),
      duration: minutes(field("مدة")),
      cast: [...new Set(doc.all("a[href*='/person/'] .entry-title").map((e) => clean(e.text())).filter(Boolean))].slice(0, 20),
      directors: [],
      countries: field("انتاج") ? [field("انتاج")] : [],
      languages: field("اللغة") ? [field("اللغة")] : [],
      // each Akwam series page is one season; the others are separate titles
      seasons: isSeries ? [{ id, number: season }] : [],
      links: imdb ? { imdb } : undefined,
    };
  },

  async episodes(ctx, filmId): Promise<Episode[]> {
    const doc = await ctx.http.doc(urlOf(ctx, filmId), { cacheMs: 10 * 60_000 });
    const seen = new Set<string>();
    return doc.all("a[href*='/episode/']").flatMap((a): Episode[] => {
      const id = pathOf(a.href(), "episode");
      const text = clean(a.text());
      if (!id || !text || seen.has(id)) return [];
      seen.add(id);
      // "حلقة 4 : مسلسل X 4" names nothing beyond the number
      const title = text.replace(/^حلقة\s*\d+\s*:\s*/, "");
      return [{ id, number: chapterNumber(text) ?? chapterNumber(id), title: title && !/^(?:مسلسل|انمي|برنامج)\s/.test(title) ? title : undefined, url: urlOf(ctx, id) }];
    });
  },

  async servers(ctx, filmId, episodeId) {
    const page = await ctx.http.doc(urlOf(ctx, episodeId ?? filmId));
    const files = await watchFiles(ctx, page);
    if (!files.length) throw new SourceError("not-found", "Akwam has no playable file for this title yet");
    return files;
  },
});

export default defineExtension({
  pkg: "storm.movisto.akwam",
  name: "Akwam",
  version: "1.0.0",
  app: "movisto",
  sources: [akwam],
});
