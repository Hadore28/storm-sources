// Azora (azorafly.com) — an Arabic manhwa site with a JSON API at api.azorafly.com.
// It also publishes novels; those are always left out.

import {
  SourceError,
  chapterNumber,
  clean,
  defineExtension,
  defineSource,
  genreIds,
  genreKey,
  genreOptions,
  mangaType,
  type Chapter,
  type Context,
  type FilterValues,
  type MangaSummary,
  type MangaType,
  type Paged,
  type Status,
  type Text,
} from "@storm-sources/sdk";

const SITE = "https://azorafly.com";
const API = "https://api.azorafly.com/api";
const PER_PAGE = 24;
const COMICS = ["MANHWA", "MANHUA", "MANGA"];

const L = (en: string, ar: string): Text => ({ en, ar });

interface Post {
  id: number;
  slug: string;
  postTitle: string;
  featuredImage: string | null;
  seriesType: string;
  seriesStatus: string;
  genres?: { id: number; name: string }[];
  postContent?: string;
  alternativeTitles?: string;
  author?: string;
  artist?: string;
  releaseDate?: string;
  isNovel?: boolean;
  lastChapterAddedAt?: string;
  mangaUpdatesUrl?: string | null;
}

interface AzChapter {
  id: number;
  slug: string;
  number: number;
  title: string | null;
  createdAt: string;
  isLocked?: boolean;
  isPermanentlyLocked?: boolean;
  isLockedByCoins?: boolean;
  price?: number;
}

const TYPE: Record<string, MangaType> = { MANHWA: "manhwa", MANHUA: "manhua", MANGA: "manga" };
const STATUS: Record<string, Status> = {
  ONGOING: "ongoing",
  COMING_SOON: "ongoing",
  COMPLETED: "completed",
  HIATUS: "hiatus",
  CANCELLED: "cancelled",
  DROPPED: "cancelled",
};

const ORDER: Record<string, string> = {
  latest: "lastChapterAddedAt",
  popular: "totalViews",
  new: "createdAt",
  az: "postTitle",
};

function summary(p: Post): MangaSummary {
  return {
    id: p.slug,
    title: p.postTitle,
    cover: p.featuredImage ?? undefined,
    url: `${SITE}/series/${p.slug}`,
    type: TYPE[p.seriesType] ?? "other",
    status: STATUS[p.seriesStatus] ?? "unknown",
    updatedAt: p.lastChapterAddedAt,
  };
}

async function query(ctx: Context, page: number, filters: FilterValues, orderBy: string, term = ""): Promise<Paged<MangaSummary>> {
  const type = (filters.type as string | undefined) || COMICS.join(",");
  const res = await ctx.http.json<{ posts: Post[]; totalCount: number }>(`${API}/query`, {
    query: {
      page,
      perPage: PER_PAGE,
      searchTerm: term,
      orderBy,
      orderDirection: orderBy === "postTitle" ? "asc" : "desc",
      genreIds: genreIds(filters.genres as string[] | undefined).join(",") || undefined,
      seriesType: type,
      seriesStatus: (filters.status as string | undefined) || undefined,
    },
    cacheMs: 5 * 60_000,
  });
  const items = res.posts.filter((p) => COMICS.includes(p.seriesType)).map(summary);
  return { items, hasNext: page * PER_PAGE < res.totalCount };
}

const azora = defineSource({
  id: "azora",
  name: "Azora",
  lang: "ar",
  baseUrl: SITE,
  icon: `${SITE}/apple-touch-icon.png`,
  rateLimit: { requests: 4, perMs: 1000 },
  headers: { Referer: `${SITE}/`, Origin: SITE, Accept: "application/json" },
  listings: [
    { id: "latest", label: L("Latest updates", "آخر التحديثات"), filters: true },
    { id: "popular", label: L("Most viewed", "الأكثر مشاهدة"), filters: true },
    { id: "new", label: L("Recently added", "أُضيفت حديثاً"), filters: true },
    { id: "az", label: L("A–Z", "أبجدياً"), filters: true },
  ],
  async filters(ctx) {
    const genres = await ctx.http.json<{ id: number; name: string }[]>(`${API}/genres`, { cacheMs: 24 * 3_600_000 });
    return [
      { id: "genres", type: "multi", label: L("Genres", "التصنيفات"), options: genreOptions(genres) },
      {
        id: "type",
        type: "select",
        label: L("Type", "النوع"),
        options: [
          { value: "MANHWA", label: L("Manhwa", "مانهوا") },
          { value: "MANHUA", label: L("Manhua", "مانهوا صينية") },
          { value: "MANGA", label: L("Manga", "مانغا") },
        ],
      },
      {
        id: "status",
        type: "select",
        label: L("Status", "الحالة"),
        options: [
          { value: "ONGOING", label: L("Ongoing", "مستمرة") },
          { value: "COMPLETED", label: L("Completed", "مكتملة") },
          { value: "HIATUS", label: L("On hiatus", "متوقفة مؤقتاً") },
          { value: "DROPPED", label: L("Dropped", "متروكة") },
        ],
      },
    ];
  },
  searchFilters: true,

  list: (ctx, { listing, page, filters }) => query(ctx, page, filters, ORDER[listing] ?? ORDER.latest),
  // Azora ignores search words without Latin letters and returns everything, so those find nothing here.
  search: (ctx, { query: text, page, filters }) =>
    /[a-z0-9]/i.test(text) ? query(ctx, page, filters, ORDER.popular, text) : Promise.resolve({ items: [], hasNext: false }),

  async manga(ctx, slug) {
    const res = await ctx.http.json<{ post?: Post }>(`${API}/post`, { query: { postSlug: slug } });
    const p = res.post;
    if (!p?.slug) throw new SourceError("not-found", `Azora has no series "${slug}"`);
    if (p.isNovel || p.seriesType === "NOVEL") throw new SourceError("not-found", `${p.postTitle} is a novel`);
    const year = Number(p.releaseDate?.slice(0, 4));
    return {
      ...summary(p),
      altTitles: (p.alternativeTitles ?? "").split(/[,،\n|]/).map(clean).filter(Boolean),
      description: p.postContent ? ctx.html(p.postContent, SITE).text() : undefined,
      authors: p.author ? [p.author] : [],
      artists: p.artist ? [p.artist] : [],
      // type names like "مانهوا" are tagged as genres on Azora
      genres: (p.genres ?? []).filter((g) => mangaType(g.name) === "other").map((g) => ({ name: g.name, key: genreKey(g.name) })),
      year: Number.isInteger(year) && year > 1900 ? year : undefined,
      links: p.mangaUpdatesUrl ? { mangaupdates: p.mangaUpdatesUrl } : undefined,
    };
  },

  async chapters(ctx, slug) {
    const list = await ctx.http.json<AzChapter[]>(`${API}/post/chapters`, { query: { postSlug: slug } });
    if (!Array.isArray(list)) throw new SourceError("changed", "Azora's chapter list is not a list");
    return list
      .slice()
      .reverse()
      .map((c): Chapter => {
        // Paid chapters can only be read on Azora itself.
        const paid = !!(c.isLocked || c.isPermanentlyLocked || c.isLockedByCoins);
        return {
          id: String(c.id),
          number: Number.isFinite(c.number) ? c.number : chapterNumber(c.slug),
          title: c.title ?? undefined,
          lang: "ar",
          date: c.createdAt,
          url: `${SITE}/series/${slug}/${c.slug}`,
          external: paid,
        };
      });
  },

  async pages(ctx, _slug, chapterId) {
    const res = await ctx.http.json<{ chapter?: { images?: { url: string; order?: number }[]; isLocked?: boolean; isAccessible?: boolean } }>(
      `${API}/chapter`,
      { query: { chapterId } },
    );
    const c = res.chapter;
    if (!c) throw new SourceError("not-found", "Azora has no such chapter");
    if (c.isLocked || c.isAccessible === false) throw new SourceError("unsupported", "This chapter is paid on Azora");
    return (c.images ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((i) => ({ url: i.url }));
  },

  resolveUrl(url) {
    const m = url.match(/azorafly\.com\/series\/([^/?#]+)/);
    return m ? { mangaId: m[1] } : null;
  },
});

export default defineExtension({
  pkg: "storm.mangasto.azora",
  name: "Azora",
  version: "1.0.0",
  app: "mangasto",
  sources: [azora],
});
