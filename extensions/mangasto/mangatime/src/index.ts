// MangaTime (mangatime.org) — an Arabic site whose app talks to a tRPC API.
// Novels are left out; premium chapters are linked to MangaTime instead.

import {
  SourceError,
  chapterNumber,
  clean,
  defineExtension,
  defineSource,
  demographic,
  genreIds,
  genreKey,
  genreOptions,
  type Chapter,
  type Context,
  type FilterValues,
  type MangaDetails,
  type MangaSummary,
  type MangaType,
  type Paged,
  type Status,
  type Text,
} from "@storm-sources/sdk";

const SITE = "https://mangatime.org";
const PER_PAGE = 24;
const COMICS = ["manga", "manhwa", "manhua", "webtoon", "comic"];

const L = (en: string, ar: string): Text => ({ en, ar });

interface Series {
  id: string;
  title: string;
  slug: string;
  coverUrl?: string | null;
  type?: string;
  status?: string;
  description?: string;
  genres?: { name: string; slug?: string }[];
  tags?: (string | { name: string })[];
  author?: string | null;
  artist?: string | null;
  alternativeTitles?: ({ title: string } | string)[] | string | null;
  year?: number | null;
  demographic?: string | null;
  originalLanguage?: string | null;
  contentRating?: string | null;
  lastChapterAt?: string | null;
  latestChapter?: { number?: number } | number | null;
}

interface MtChapter {
  id: string;
  number: number;
  volume?: number | null;
  title?: string | null;
  language?: string;
  pageCount?: number;
  isPremium?: boolean;
  isUnlocked?: boolean;
  publishedAt?: string;
  createdAt?: string;
}

const TYPE: Record<string, MangaType> = { manga: "manga", manhwa: "manhwa", webtoon: "manhwa", manhua: "manhua", comic: "comic" };
const STATUS: Record<string, Status> = { ongoing: "ongoing", completed: "completed", hiatus: "hiatus", cancelled: "cancelled" };

const abs = (u?: string | null) => (u ? (u.startsWith("http") ? u : `${SITE}${u.startsWith("/") ? "" : "/"}${u}`).replace(/ /g, "%20") : undefined);

// tRPC over GET: the input is a batch of one, answers come back the same way.
async function call<T>(ctx: Context, procedure: string, input: unknown, cacheMs?: number): Promise<T> {
  const res = await ctx.http.request("GET", `${SITE}/api/trpc/${procedure}`, {
    query: { batch: 1, input: JSON.stringify({ 0: { json: input } }) },
    headers: { Accept: "application/json" },
    cacheMs,
  });
  const body = await res.json<{ result?: { data?: { json?: T } }; error?: { json?: { message?: string; data?: { code?: string } } } }[]>();
  const first = body?.[0];
  if (first?.result?.data && "json" in first.result.data) return first.result.data.json as T;
  const code = first?.error?.json?.data?.code;
  if (code === "NOT_FOUND") throw new SourceError("not-found", first?.error?.json?.message ?? "Not found on MangaTime");
  if (res.status === 429) throw new SourceError("rate-limited", "MangaTime is rate limiting us");
  throw new SourceError("changed", `MangaTime ${procedure}: ${first?.error?.json?.message ?? `answered ${res.status}`}`);
}

function summary(s: Series): MangaSummary {
  const latest = typeof s.latestChapter === "number" ? s.latestChapter : s.latestChapter?.number;
  return {
    id: s.slug,
    title: s.title,
    cover: abs(s.coverUrl),
    url: `${SITE}/series/${s.slug}`,
    type: TYPE[s.type ?? ""] ?? "other",
    status: STATUS[s.status ?? ""] ?? "unknown",
    latestChapter: Number.isFinite(latest) ? latest : undefined,
    updatedAt: s.lastChapterAt ?? undefined,
  };
}

const SORT: Record<string, string> = { popular: "popularity", latest: "recent", trending: "TRENDING", top: "rating", az: "alphabetical" };

async function search(ctx: Context, page: number, filters: FilterValues, sortBy: string, query?: string): Promise<Paged<MangaSummary>> {
  const type = filters.type as string[] | undefined;
  const status = filters.status as string[] | undefined;
  const res = await call<{ results: Series[]; hasMore: boolean }>(
    ctx,
    "search.searchSeries",
    {
      page,
      limit: PER_PAGE,
      sortBy,
      query,
      filters: {
        genres: genreIds(filters.genres as string[] | undefined, "|").length ? genreIds(filters.genres as string[], "|") : undefined,
        type: type?.length ? type : COMICS,
        status: status?.length ? status : undefined,
      },
    },
    5 * 60_000,
  );
  return { items: res.results.filter((s) => s.type !== "novel").map(summary), hasNext: !!res.hasMore };
}

async function series(ctx: Context, slug: string) {
  return call<Series>(ctx, "content.getSeriesBySlug", { slug }, 10 * 60_000);
}

const mangatime = defineSource({
  id: "mangatime",
  name: "MangaTime",
  lang: "ar",
  baseUrl: SITE,
  icon: `${SITE}/images/logo-64.png`,
  rateLimit: { requests: 4, perMs: 1000 },
  headers: { Referer: `${SITE}/` },
  listings: [
    { id: "popular", label: L("Popular", "الأكثر شعبية"), filters: true },
    { id: "latest", label: L("Latest updates", "آخر التحديثات"), filters: true },
    { id: "trending", label: L("Trending", "الرائجة"), filters: true },
    { id: "top", label: L("Top rated", "الأعلى تقييماً"), filters: true },
    { id: "az", label: L("A–Z", "أبجدياً"), filters: true },
  ],
  async filters(ctx) {
    const { genres } = await call<{ genres: { name: string; slug: string; seriesCount: number }[] }>(ctx, "content.getGenres", {}, 24 * 3_600_000);
    return [
      { id: "genres", type: "multi", label: L("Genres", "التصنيفات"), options: genreOptions(genres.filter((g) => g.seriesCount > 0).map((g) => ({ id: g.slug, name: g.name })), "|") },
      {
        id: "type",
        type: "multi",
        label: L("Type", "النوع"),
        options: [
          { value: "manga", label: L("Manga", "مانغا") },
          { value: "manhwa", label: L("Manhwa", "مانهوا") },
          { value: "manhua", label: L("Manhua", "مانهوا صينية") },
          { value: "webtoon", label: L("Webtoon", "ويبتون") },
        ],
      },
      {
        id: "status",
        type: "multi",
        label: L("Status", "الحالة"),
        options: [
          { value: "ongoing", label: L("Ongoing", "مستمرة") },
          { value: "completed", label: L("Completed", "مكتملة") },
          { value: "hiatus", label: L("On hiatus", "متوقفة مؤقتاً") },
          { value: "cancelled", label: L("Cancelled", "ملغاة") },
        ],
      },
    ];
  },
  searchFilters: true,

  list: (ctx, { listing, page, filters }) => search(ctx, page, filters, SORT[listing] ?? SORT.popular),
  search: (ctx, { query, page, filters }) => search(ctx, page, filters, "relevance", query),

  async manga(ctx, slug): Promise<MangaDetails> {
    const s = await series(ctx, slug);
    if (s.type === "novel") throw new SourceError("not-found", `${s.title} is a novel`);
    const alt = Array.isArray(s.alternativeTitles)
      ? s.alternativeTitles.map((t) => (typeof t === "string" ? t : t.title))
      : (s.alternativeTitles ?? "").split(/[,،\n|]/);
    return {
      ...summary(s),
      altTitles: alt.map(clean).filter(Boolean),
      description: s.description ? ctx.html(s.description, SITE).text() : undefined,
      authors: s.author ? s.author.split(/[,،]/).map(clean).filter(Boolean) : [],
      artists: s.artist ? s.artist.split(/[,،]/).map(clean).filter(Boolean) : [],
      // genres as given; free-form tags ("كرة القدم") only when they name a storm genre
      genres: [
        ...(s.genres ?? []).map((g) => ({ name: g.name, key: genreKey(g.name) })),
        ...(s.tags ?? [])
          .map((g) => (typeof g === "string" ? g : g.name))
          .map((name) => ({ name, key: genreKey(name) }))
          .filter((g) => g.key),
      ],
      demographic: demographic(s.demographic),
      year: s.year ?? undefined,
      originalLang: s.originalLanguage ?? undefined,
      rating: s.contentRating === "mature" || s.contentRating === "adult" ? "nsfw" : undefined,
    };
  },

  async chapters(ctx, slug) {
    const s = await series(ctx, slug);
    const { chapters } = await call<{ chapters: MtChapter[] }>(ctx, "content.getChapters", { seriesId: s.id, limit: -1 });
    return chapters.map((c): Chapter => {
      // "الفصل 363: لعبة المحظورات" → "لعبة المحظورات"; a bare "الفصل 363" says nothing new
      const title = clean(c.title?.replace(/^(?:الفصل|chapter)\s*[\d.]+\s*[:\-–]?\s*/i, ""));
      return {
        id: String(c.number),
        number: Number.isFinite(c.number) ? c.number : chapterNumber(c.title),
        volume: c.volume ?? undefined,
        title: title || undefined,
        lang: c.language ?? "ar",
        date: c.publishedAt ?? c.createdAt,
        url: `${SITE}/series/${slug}/chapter/${c.number}`,
        // premium chapters are read, and paid for, on MangaTime
        external: !!c.isPremium && c.isUnlocked === false,
        pages: c.pageCount,
      };
    });
  },

  async pages(ctx, slug, chapterId) {
    const res = await call<{ pages?: string[]; isUnlocked?: boolean }>(ctx, "content.getChapterPages", { seriesSlug: slug, chapterNumber: Number(chapterId) });
    if (res.isUnlocked === false) throw new SourceError("unsupported", "This chapter is premium on MangaTime");
    return (res.pages ?? []).map((u) => ({ url: abs(u)! }));
  },

  resolveUrl(url) {
    const m = url.match(/mangatime\.org\/(?:series|manga|manhwa|manhua|webtoon|comic)\/([^/?#]+)(?:\/chapter[-/]([\d.]+))?/);
    return m ? { mangaId: m[1], chapterId: m[2] } : null;
  },
});

export default defineExtension({
  pkg: "storm.mangasto.mangatime",
  name: "MangaTime",
  version: "1.0.0",
  app: "mangasto",
  sources: [mangatime],
});
